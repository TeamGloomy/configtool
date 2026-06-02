<style scoped>
.table-spi tr > td,
.table-spi tr > th {
	vertical-align: middle;
}
.locked-label {
	font-size: 0.8em;
}
.spi-type-badge {
	font-size: 0.7em;
	vertical-align: middle;
}
/* Locked rows get a subtle left-border indicator instead of table-secondary,
   which has contrast issues in dark mode. */
.row-locked > td:first-child {
	border-left: 3px solid var(--bs-secondary-color);
}
/* Pin values shown as code snippets so they inherit the explicit code colour
   rather than the muted/secondary colour that blends with dark backgrounds. */
.pin-label {
	font-family: var(--bs-font-monospace);
	font-size: 0.875em;
	color: var(--bs-body-color);
	opacity: 0.65;
}
</style>

<template>
	<config-section board-txt :type="ConfigSectionType.SpiConfig" title="SPI Configuration">
		<template #append-title>
			<a href="https://teamgloomy.github.io/general_spi.html" target="_blank">
				<i class="bi-info-circle"></i>
				SPI on STM32
			</a>
		</template>

		<table class="table table-sm table-bordered table-spi mb-0">
			<thead class="table-secondary">
				<tr>
					<th class="text-nowrap">Channel</th>
					<th>SCK</th>
					<th>MISO</th>
					<th>MOSI</th>
					<th>Role / Purpose</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="i in 9" :key="i - 1" :class="{ 'row-locked': !!channels[i - 1].lockedFor }">
					<td class="text-nowrap">
						<strong>SPI{{ i - 1 }}</strong>
						<span class="badge ms-1 spi-type-badge"
							  :class="isHardwareSpi(i - 1) ? 'bg-secondary' : 'bg-info text-dark'">
							{{ isHardwareSpi(i - 1) ? 'HW' : 'SW' }}
						</span>
					</td>
					<!-- SCK -->
					<td>
						<text-input v-if="!channels[i - 1].lockedFor"
									:model-value="getPinValue(i - 1, 0)"
									@update:model-value="setPinValue(i - 1, 0, $event)"
									:preset="channels[i - 1].pins?.[0] ?? ''"
									:max-length="8" :required="false" placeholder="NoPin" />
						<span v-else class="pin-label">{{ channels[i - 1].pins?.[0] ?? 'NoPin' }}</span>
					</td>
					<!-- MISO -->
					<td>
						<text-input v-if="!channels[i - 1].lockedFor"
									:model-value="getPinValue(i - 1, 1)"
									@update:model-value="setPinValue(i - 1, 1, $event)"
									:preset="channels[i - 1].pins?.[1] ?? ''"
									:max-length="8" :required="false" placeholder="NoPin" />
						<span v-else class="pin-label">{{ channels[i - 1].pins?.[1] ?? 'NoPin' }}</span>
					</td>
					<!-- MOSI -->
					<td>
						<text-input v-if="!channels[i - 1].lockedFor"
									:model-value="getPinValue(i - 1, 2)"
									@update:model-value="setPinValue(i - 1, 2, $event)"
									:preset="channels[i - 1].pins?.[2] ?? ''"
									:max-length="8" :required="false" placeholder="NoPin" />
						<span v-else class="pin-label">{{ channels[i - 1].pins?.[2] ?? 'NoPin' }}</span>
					</td>
					<!-- Role -->
					<td>
						<span v-if="channels[i - 1].lockedFor" class="locked-label text-body-secondary">
							<i class="bi-lock-fill me-1"></i>{{ channels[i - 1].lockedFor }}
						</span>
						<select-input v-else
									  :model-value="getRoleForChannel(i - 1)"
									  @update:model-value="setRoleForChannel(i - 1, $event)"
									  :options="roleOptions"
									  :required="false" />
					</td>
				</tr>
			</tbody>
		</table>
	</config-section>
</template>

<script setup lang="ts">
import { computed } from "vue";

import ConfigSection from "@/components/ConfigSection.vue";
import SelectInput from "@/components/inputs/SelectInput.vue";
import TextInput from "@/components/inputs/TextInput.vue";

import { useStore } from "@/store";
import { ConfigSectionType } from "@/store/sections";
import { isSTM32BoardType, parseSTM32SpiChannels, type STM32BoardDescriptor } from "@/store/STM32Boards";

const store = useStore();

const roleOptions = [
	{ text: "—",                                value: "none" },
	{ text: "Accelerometer",                    value: "accel" },
	{ text: "Temperature Sensors (BME280/PT100)", value: "temp" },
];

// Hardware SPI channels on STM32H7: 0,1,2,6,7,8 — software: 3,4,5
function isHardwareSpi(ch: number) {
	return ch <= 2 || ch >= 6;
}

const stm32BoardDef = computed(() => {
	const bt = store.data.boardType;
	if (bt !== null && isSTM32BoardType(bt)) {
		return store.data.boardDefinition as STM32BoardDescriptor | null;
	}
	return null;
});

const channels = computed(() => {
	const def = stm32BoardDef.value;
	if (!def) return Array.from({ length: 9 }, () => ({ pins: null as [string,string,string] | null, lockedFor: null as string | null }));
	const parsed = parseSTM32SpiChannels(def.boardTxtContent);
	// Merge in any supplemental locks from the wiki that the rrfboot doesn't capture
	if (def.spiChannelLocks) {
		for (const [ch, reason] of Object.entries(def.spiChannelLocks)) {
			const idx = parseInt(ch);
			if (!parsed[idx].lockedFor) parsed[idx].lockedFor = reason;
		}
	}
	// When a 12864 display is enabled it occupies SPI channel 5 — lock it so it can't be reused.
	if (def.supports12864 && store.data.configTool.stm32Display12864) {
		parsed[5].lockedFor = "12864 display";
	}
	return parsed;
});

const accelPreset = computed(() => stm32BoardDef.value?.accelPreset ?? null);

// Per-channel pin access — stored as "SCK,MISO,MOSI" or ""
const SPI_KEYS = [
	"stm32SpiCh0", "stm32SpiCh1", "stm32SpiCh2",
	"stm32SpiCh3", "stm32SpiCh4", "stm32SpiCh5",
	"stm32SpiCh6", "stm32SpiCh7", "stm32SpiCh8",
] as const;

function getStoredPins(channel: number): [string, string, string] | null {
	const raw = (store.data.configTool as any)[SPI_KEYS[channel]] as string;
	if (!raw) return null;
	const parts = raw.split(',');
	return parts.length === 3 ? parts as [string,string,string] : null;
}

function getPinValue(channel: number, pos: 0 | 1 | 2): string {
	const stored = getStoredPins(channel);
	if (stored) return stored[pos];
	return channels.value[channel].pins?.[pos] ?? "";
}

function setPinValue(channel: number, pos: 0 | 1 | 2, value: string) {
	const current: [string, string, string] = [
		getPinValue(channel, 0),
		getPinValue(channel, 1),
		getPinValue(channel, 2),
	];
	current[pos] = value;
	const defaultPins = channels.value[channel].pins;
	const matchesDefault =
		current[0] === (defaultPins?.[0] ?? "") &&
		current[1] === (defaultPins?.[1] ?? "") &&
		current[2] === (defaultPins?.[2] ?? "");
	const allEmpty = current.every(p => !p);
	(store.data.configTool as any)[SPI_KEYS[channel]] =
		(matchesDefault || allEmpty) ? "" : current.join(',');
}

function getRoleForChannel(channel: number): string {
	if (store.data.configTool.stm32AccelSpiChannel === channel) return "accel";
	if (store.data.configTool.stm32SpiTempChannel === channel) return "temp";
	return "none";
}

function setRoleForChannel(channel: number, role: string) {
	// Clear any previous role this channel held
	if (store.data.configTool.stm32AccelSpiChannel === channel) {
		store.data.configTool.stm32AccelSpiChannel = -1;
		store.data.configTool.stm32AccelCsPin      = "";
		store.data.configTool.stm32AccelIntPin     = "";
	}
	if (store.data.configTool.stm32SpiTempChannel === channel) {
		store.data.configTool.stm32SpiTempChannel = -1;
	}

	if (role === "accel") {
		store.data.configTool.stm32AccelSpiChannel = channel;
		// If this is the board's suggested accel channel, pre-fill the wiring (editable in the
		// Accelerometers section) and apply any SPI pin override the accel wiring needs.
		if (accelPreset.value && accelPreset.value.spiChannel === channel) {
			if (!store.data.configTool.stm32AccelCsPin)  store.data.configTool.stm32AccelCsPin  = accelPreset.value.csPin;
			if (!store.data.configTool.stm32AccelIntPin) store.data.configTool.stm32AccelIntPin = accelPreset.value.intPin;
			if (accelPreset.value.spiPins) {
				(store.data.configTool as any)[SPI_KEYS[channel]] =
					`${accelPreset.value.spiPins.sck},${accelPreset.value.spiPins.miso},${accelPreset.value.spiPins.mosi}`;
			}
		}
	} else if (role === "temp") {
		store.data.configTool.stm32SpiTempChannel = channel;
	}
}
</script>
