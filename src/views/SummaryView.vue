<template>
	<main class="container mt-2">
		<div class="text-center mb-4">
			<h2 class="mb-4">
				Configuration ready
			</h2>

			<h4>
				The config tool can now generate the following system files:
			</h4>
		</div>

		<div class="row mb-4">
			<div class="col-2"></div>
			<div class="col-8">
				<div class="card">
					<div class="card-body">
						<ul class="mb-0">
							<li v-for="template in templates">
								<a href="javascript:void(0)" @click="showFile(template)">
									{{ getOutputFilename(template.name) }}
								</a>
								<progress-icon :model-value="template.state" />
							</li>
						</ul>
					</div>
				</div>

				<div v-if="!store.data.sbcMode" class="mt-3">
					<check-input v-model="includeRRF" :disabled="generating" label="Include firmware files"
								 title="Include firmware files in the configuration bundle" :preset="true">
						<template #append>
							<progress-icon :model-value="rrfState" />
						</template>
					</check-input>
					<check-input v-model="includeDWC" :disabled="generating" label="Include web interface"
								 title="Include web interface in the configuration bundle" :preset="true">
						<template #append>
							<progress-icon :model-value="dwcState" />
						</template>
					</check-input>
				</div>
			</div>
			<div class="col-2"></div>
		</div>

		<div class="d-flex flex-column">
			<button class="btn btn-primary btn-lg mx-auto mb-3" :disabled="generating" @click="generateBundle">
				<i class="bi" :class="generating ? 'bi-hourglass' : 'bi-download'"></i>
				{{ generating ? "Generating Config Bundle..." : "Download Config Bundle" }}
			</button>

			<a href="javascript:void(0)" class="mx-auto" @click="generateConfigData">
				<i class="bi bi-database-fill-down"></i>
				Save Config Template
			</a>
		</div>
	</main>
</template>

<script setup lang="ts">
import saveAs from "file-saver";
import JSZip from "jszip";
import { onMounted, ref } from "vue";

import CheckInput from "@/components/inputs/CheckInput.vue";

import { useStore } from "@/store";
import { render, renderToNewTab, getOutputFilename } from "@/store/render";
import { getSectionTemplates } from "@/store/sections";
import { isSTM32BoardType, getSTM32FirmwareFile, getSTM32WifiFile, getSTM32IapFile, STM32_FIRMWARE_REPO, STM32_FIRMWARE_BRANCH, type STM32BoardDescriptor } from "@/store/STM32Boards";
import ProgressIcon, { ProgressState } from "@/components/ProgressIcon.vue";

const store = useStore();

// Template list
interface TemplateItem {
	name: string;
	data: Record<string, any> | null;
	state: ProgressState | null
}

const templates = ref<Array<TemplateItem>>([]);

function isSTM32Board(): boolean {
	const bt = store.data.boardType;
	return bt !== null && isSTM32BoardType(bt);
}

onMounted(() => {
	const items: Array<TemplateItem> = [];
	// Add board.txt first for STM32 boards
	if (isSTM32Board()) {
		items.push({ name: "boardtxt", data: null, state: null });
	}
	items.push(...getSectionTemplates().map(item => ({
		name: item.template,
		data: item.data,
		state: null
	})));
	templates.value = items;
});

async function showFile(item: TemplateItem) {
	if (!generating.value) {
		item.state = ProgressState.busy;
	}

	try {
		await renderToNewTab(item.name, item.data ?? undefined);
	} catch (e) {
		console.error("Failed to generate template", item.name, item.data, e);
		alert(`Failed to generate template ${getOutputFilename(item.name)}: ${e}`);
	}

	if (!generating.value) {
		item.state = null;
	}
}

// Bundle Generation
const generating = ref(false);

const includeRRF = ref(true), rrfState = ref<ProgressState | null>(null);
async function downloadRRF(): Promise<Array<File>> {
	const result: Array<File> = [];
	rrfState.value = ProgressState.busy;
	try {
		for (const board of store.data.boards) {
			// STM32 / community boards get their firmware from downloadSTM32Firmware() (GitHub),
			// not from the Duet /assets store — skip them here. Their firmwareFileName is "".
			if (getSTM32FirmwareFile(board.shortName) !== null) {
				continue;
			}

			// Download firmware file (firmwareFileName defaults to "" in the object model, so
			// guard against empty as well as null — an empty name would 404 on /assets/.../)
			if (board.firmwareFileName) {
				const response = await fetch(`${import.meta.env.BASE_URL}assets/RepRapFirmware/${board.firmwareFileName}`);
				if (!response.ok) {
					throw new Error(`Failed to download ${board.firmwareFileName}: ${response.status} ${response.statusText}`);
				}

				const file = new File([await response.blob()], board.firmwareFileName);
				result.push(file);
			}

			// Download IAP file only for the mainboard
			if (!board.canAddress && board.iapFileNameSD) {
				const response = await fetch(`${import.meta.env.BASE_URL}assets/RepRapFirmware/${board.iapFileNameSD}`);
				if (!response.ok) {
					throw new Error(`Failed to download ${board.iapFileNameSD}: ${response.status} ${response.statusText}`);
				}

				const file = new File([await response.blob()], board.iapFileNameSD);
				result.push(file);
			}
		}
		rrfState.value = ProgressState.ready;
		return result;
	} catch (e) {
		rrfState.value = ProgressState.error;
		throw e;
	}
}

// STM32 / community firmware lives as individual files in the gloomyandy/RRFBuild repo tree
// under releases/<version>/{mainboard/<oem>,expansion,wifi}/ (the repo's release *assets*
// are only whole-bundle zips). Pick the latest stable version, map every firmware file by
// basename, then download the mainboard firmware, WiFi build, and any community expansion firmware.
interface STM32FirmwareFile { zipPath: string; blob: Blob }
async function downloadSTM32Firmware(): Promise<Array<STM32FirmwareFile>> {
	const result: Array<STM32FirmwareFile> = [];

	// Only fetch firmware if this config actually needs community firmware
	const needsFirmware = store.data.boards.some(board => getSTM32FirmwareFile(board.shortName) !== null);
	if (!needsFirmware) {
		return result;
	}

	rrfState.value = ProgressState.busy;
	try {
		const apiBase = `https://api.github.com/repos/${STM32_FIRMWARE_REPO}`;
		const rawBase = `https://raw.githubusercontent.com/${STM32_FIRMWARE_REPO}/${STM32_FIRMWARE_BRANCH}`;

		// 1. List the release version directories and pick the latest stable one (no -beta/-rc)
		const relResp = await fetch(`${apiBase}/contents/releases?ref=${STM32_FIRMWARE_BRANCH}`);
		if (!relResp.ok) {
			throw new Error(`Failed to list firmware releases: ${relResp.status} ${relResp.statusText}`);
		}
		const relEntries: Array<any> = await relResp.json();
		const versionDirs = relEntries.filter(e => e.type === "dir" && /^\d+\.\d+\.\d+$/.test(e.name));
		if (versionDirs.length === 0) {
			throw new Error("No stable firmware release directory found");
		}
		versionDirs.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
		const versionDir = versionDirs[0];

		// 2. Build a basename -> repo path map for every firmware file under releases/<version>
		const treeResp = await fetch(`${apiBase}/git/trees/${versionDir.sha}?recursive=1`);
		if (!treeResp.ok) {
			throw new Error(`Failed to read firmware file tree: ${treeResp.status} ${treeResp.statusText}`);
		}
		const tree: Array<any> = (await treeResp.json()).tree ?? [];
		const fileMap = new Map<string, string>();		// basename -> full repo path
		for (const t of tree) {
			if (t.type === "blob" && typeof t.path === "string" && (t.path.endsWith(".bin") || t.path.endsWith(".uf2"))) {
				fileMap.set(t.path.split("/").pop()!, `releases/${versionDir.name}/${t.path}`);
			}
		}

		const fetchBin = async (basename: string): Promise<Blob> => {
			const path = fileMap.get(basename);
			if (!path) {
				throw new Error(`Firmware file "${basename}" not found in release ${versionDir.name}`);
			}
			const r = await fetch(`${rawBase}/${path}`);
			if (!r.ok) {
				throw new Error(`Failed to download ${basename}: ${r.status} ${r.statusText}`);
			}
			return r.blob();
		};

		const isSbc = store.data.sbc !== null;

		// 3. Mainboard + every CAN-connected community board
		for (const board of store.data.boards) {
			const fw = getSTM32FirmwareFile(board.shortName);
			if (!fw) {
				continue;
			}
			const blob = await fetchBin(fw.fileName);

			if (!board.canAddress) {
				// Mainboard firmware is renamed to firmware.bin and placed at the SD card root
				result.push({ zipPath: "firmware.bin", blob });
			} else {
				// Expansion firmware goes in firmware/ with the Duet3Firmware_ naming RRF expects
				// for CAN board updates. RP2040 .uf2 files are already Duet3Firmware_-prefixed;
				// STM32-expansion firmware_<board>.bin is renamed to Duet3Firmware_<board>.bin.
				const name = fw.isUf2
					? fw.fileName
					: `Duet3Firmware_${fw.fileName.replace(/^firmware_/, "")}`;
				result.push({ zipPath: `firmware/${name}`, blob });
			}
		}

		// 4. STM32 mainboard extras
		if (isSTM32Board()) {
			const mainDef = store.data.boardDefinition as STM32BoardDescriptor | null;
			if (isSbc) {
				// SBC mode: the MCU-specific IAP file is needed to flash firmware from the SBC.
				// No WiFi module is involved.
				const iapName = getSTM32IapFile(store.data.boards[0]?.shortName);
				if (iapName) {
					result.push({ zipPath: `firmware/${iapName}`, blob: await fetchBin(iapName) });
				}
			} else if (mainDef?.wifiConfig) {
				// Standalone mode: WiFi server firmware for the selected module type
				const wifiName = getSTM32WifiFile(store.data.configTool.stm32WifiModuleType);
				result.push({ zipPath: `firmware/${wifiName}`, blob: await fetchBin(wifiName) });
			}
		}

		rrfState.value = ProgressState.ready;
		return result;
	} catch (e) {
		rrfState.value = ProgressState.error;
		throw e;
	}
}

const includeDWC = ref(true), dwcState = ref<ProgressState | null>(null);
async function downloadDWC(): Promise<Array<File>> {
	const result: Array<File> = [];
	dwcState.value = ProgressState.busy;
	try {
		// Download DWC bundle
		const response = await fetch(`${import.meta.env.BASE_URL}assets/DuetWebControl.zip`);
		const content = await response.blob();

		// Unpack it
		const zip = await JSZip.loadAsync(content), promises: Array<Promise<void>> = [];
		zip.forEach(function (_, file) {
			promises.push(file.async("blob").then(value => { result.push(new File([value], file.name)); }));
		});
		await Promise.all(promises);

		// Done
		dwcState.value = ProgressState.ready;
		return result;
	} catch (e) {
		dwcState.value = ProgressState.error;
		throw e;
	}
}

async function generateBundle() {
	generating.value = true;
	try {
		// Start downloading firmware and DWC. Duet firmware + DWC come from /assets and are only
		// needed for standalone (non-SBC) configs — in SBC mode firmware is delivered by DSF.
		// STM32/community firmware comes from the gloomyandy/RRFBuild repo tree and IS needed in
		// SBC mode too (the MCU IAP file), so it runs regardless of sbcMode. The two RRF sources
		// run in sequence so they don't race the shared progress indicator.
		const rrfPromise = includeRRF.value
			? (async () => ({
				duet: store.data.sbcMode ? [] as Array<File> : await downloadRRF(),
				stm32: await downloadSTM32Firmware(),
			}))()
			: Promise.resolve({ duet: [] as Array<File>, stm32: [] as Array<STM32FirmwareFile> });
		const dwcPromise = (!store.data.sbcMode && includeDWC.value) ? downloadDWC() : Promise.resolve([] as Array<File>);

		// Reset states
		for (const item of templates.value) {
			item.state = null;
		}

		// Create a new ZIP file
		const zip = new JSZip();

		// Start generating templates
		for (const item of templates.value) {
			item.state = ProgressState.busy;
			try {
				const content = await render(item.name, { ...(item.data ?? {}), preview: false });
				const outputFile = getOutputFilename(item.name);
				// board.txt goes to SD card root; everything else to sys/
				const zipPath = (item.name === "boardtxt") ? outputFile : `sys/${outputFile}`;
				zip.file(zipPath, content);
				item.state = ProgressState.ready;
			} catch (e) {
				item.state = ProgressState.error;
				const outputFile = getOutputFilename(item.name);
				console.error(`Failed to generate template ${outputFile}:`, item.data, e);
				alert(`Failed to generate template ${outputFile}: ${e}`);
			}
		}

		// Include RRF/DWC
		try {
			// Add RRF files to the bundle
			const { duet: rrfFiles, stm32: stm32Files } = await rrfPromise;
			for (const file of rrfFiles) {
				zip.file(`firmware/${file.name}`, file);
			}
			// STM32/community firmware carries its own destination path (firmware.bin at root,
			// WiFi + expansion firmware under firmware/)
			for (const item of stm32Files) {
				zip.file(item.zipPath, item.blob);
			}

			// Add DWC files to the bundle
			const dwcFiles = await dwcPromise;
			for (const file of dwcFiles) {
				zip.file(`www/${file.name}`, file);
			}
		} catch (e) {
			console.error(e);
			alert(e);
			return;
		}

		// Add config data
		const modelJson = JSON.stringify(store.data);
		zip.file("sys/configtool.json", modelJson);

		// Build final ZIP and save it
		try {
			const zipBundle = await zip.generateAsync({ type: "blob" });
			saveAs(zipBundle, "config.zip");
		} catch (e) {
			console.error("Failed to generate ZIP bundle", e);
			alert(`Failed to generate ZIP bundle: ${e}`);
		}
	} finally {
		// Done
		generating.value = false;
	}
	store.showSavePrompt = false;
}

async function generateConfigData() {
	const modelJson = JSON.stringify(store.data);
	saveAs(new Blob([modelJson]), "configtool.json");
	store.showSavePrompt = false;
}
</script>
