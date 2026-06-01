// Downloads the Duet firmware, IAP and DuetWebControl assets that the config tool serves
// from the same-origin /assets/ path at runtime, into public/assets/. CI runs this before
// `npm run build` (and `predev` runs it for local dev); the files are gitignored, never committed.
//
// Source: the Duet3D GitHub *releases* (api/objects.githubusercontent.com), which GitHub
// Actions runners can always reach. The official configtool.duet3d.com host blocks datacenter
// IPs (403 from CI), so it can't be used here.
//   - Firmware (.bin/.uf2) + DuetWebControl-SD.zip are published as individual release assets.
//   - IAP files are only inside the combined "Duet2and3Firmware-*.zip" asset, so we download
//     that once and extract the needed IAP files from it.
//
// STM32 / community board firmware is NOT fetched here — it is downloaded live from
// raw.githubusercontent.com at bundle time (that host does send CORS headers for the browser).
//
// The firmware/IAP filename list is parsed from src/store/Boards.ts so it stays in sync.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const RRF_REPO = process.env.CONFIGTOOL_RRF_REPO || "Duet3D/RepRapFirmware";
const DWC_REPO = process.env.CONFIGTOOL_DWC_REPO || "Duet3D/DuetWebControl";

const RRF_DIR = join(repoRoot, "public", "assets", "RepRapFirmware");
const ASSETS_DIR = join(repoRoot, "public", "assets");

const UA = { "User-Agent": "configtool-fetch-assets" };
const force = process.argv.includes("--force");

/** Pull every firmware/IAP filename referenced by the Duet board definitions. */
function collectFirmwareFiles() {
	const boardsTs = readFileSync(join(repoRoot, "src", "store", "Boards.ts"), "utf8");
	const fw = new Set(), iap = new Set();
	let m;
	const fwRe = /firmwareFileName\s*:\s*"([^"]+)"/g;
	while ((m = fwRe.exec(boardsTs)) !== null) fw.add(m[1]);
	const iapRe = /(?:iapFileNameSD|iapFileNameSBC)\s*:\s*"([^"]+)"/g;
	while ((m = iapRe.exec(boardsTs)) !== null) iap.add(m[1]);
	return { firmware: [...fw].sort(), iap: [...iap].sort() };
}

async function ghJson(url) {
	const r = await fetch(url, { headers: UA });
	if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
	return r.json();
}

/** Latest non-prerelease, non-draft release for a repo. */
async function latestRelease(repo) {
	const releases = await ghJson(`https://api.github.com/repos/${repo}/releases`);
	const rel = releases.find(r => !r.prerelease && !r.draft) ?? releases[0];
	if (!rel) throw new Error(`No release found for ${repo}`);
	return rel;
}

function assetMap(release) {
	const map = new Map();
	for (const a of release.assets ?? []) map.set(a.name, a.browser_download_url);
	return map;
}

async function downloadTo(url, destPath) {
	const r = await fetch(url, { headers: UA });
	if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
	const buf = Buffer.from(await r.arrayBuffer());
	mkdirSync(dirname(destPath), { recursive: true });
	writeFileSync(destPath, buf);
	return buf.length;
}

async function main() {
	const { firmware, iap } = collectFirmwareFiles();
	console.log(`Found ${firmware.length} firmware + ${iap.length} IAP files referenced in Boards.ts`);

	const rrf = await latestRelease(RRF_REPO);
	const dwc = await latestRelease(DWC_REPO);
	const rrfAssets = assetMap(rrf);
	const dwcAssets = assetMap(dwc);
	console.log(`RepRapFirmware ${rrf.tag_name}, DuetWebControl ${dwc.tag_name}`);

	let ok = 0, skipped = 0, missingRequired = 0, missingOptional = [], bytes = 0;
	const note = (sym, label, extra = "") => console.log(`  ${sym} ${label}${extra}`);

	// 1. DuetWebControl bundle (required). Published as DuetWebControl-SD.zip; saved as
	//    DuetWebControl.zip (the name the config tool fetches at runtime).
	{
		const dest = join(ASSETS_DIR, "DuetWebControl.zip");
		if (!force && existsSync(dest)) { skipped++; }
		else {
			const url = dwcAssets.get("DuetWebControl-SD.zip");
			try {
				if (!url) throw new Error("DuetWebControl-SD.zip not in release");
				const size = await downloadTo(url, dest);
				bytes += size; ok++;
				note("✓", "DuetWebControl.zip", ` (${(size / 1024).toFixed(0)} KB)`);
			} catch (e) {
				missingRequired++;
				note("✗", "REQUIRED DuetWebControl.zip", ` — ${e.message}`);
			}
		}
	}

	// 2. Firmware files — individual release assets.
	for (const name of firmware) {
		const dest = join(RRF_DIR, name);
		if (!force && existsSync(dest)) { skipped++; continue; }
		const url = rrfAssets.get(name);
		try {
			if (!url) throw new Error("not published as a release asset");
			const size = await downloadTo(url, dest);
			bytes += size; ok++;
			note("✓", `RepRapFirmware/${name}`, ` (${(size / 1024).toFixed(0)} KB)`);
		} catch (e) {
			missingOptional.push(name);
			note("⚠", `optional RepRapFirmware/${name}`, ` — ${e.message}`);
		}
	}

	// 3. IAP files — only inside the combined "Duet2and3Firmware-*.zip" asset. Download once
	//    and extract the needed ones. Skipped gracefully if all IAPs already present or the
	//    zip / unzip support is unavailable.
	const iapNeeded = iap.filter(n => force || !existsSync(join(RRF_DIR, n)));
	if (iapNeeded.length > 0) {
		try {
			const zipName = [...rrfAssets.keys()].find(n => /^Duet2and3Firmware.*\.zip$/.test(n));
			if (!zipName) throw new Error("combined firmware zip not found in release");
			const { default: JSZip } = await import("jszip");
			const r = await fetch(rrfAssets.get(zipName), { headers: UA });
			if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${zipName}`);
			const zip = await JSZip.loadAsync(await r.arrayBuffer());
			// Map basename -> entry (zip may store with or without folders)
			const byBase = new Map();
			zip.forEach((path, file) => { if (!file.dir) byBase.set(path.split("/").pop(), file); });
			for (const name of iapNeeded) {
				const entry = byBase.get(name);
				if (!entry) { missingOptional.push(name); note("⚠", `optional RepRapFirmware/${name}`, " — not in firmware zip"); continue; }
				const buf = Buffer.from(await entry.async("arraybuffer"));
				const dest = join(RRF_DIR, name);
				mkdirSync(dirname(dest), { recursive: true });
				writeFileSync(dest, buf);
				bytes += buf.length; ok++;
				note("✓", `RepRapFirmware/${name}`, ` (${(buf.length / 1024).toFixed(0)} KB, from zip)`);
			}
		} catch (e) {
			// Couldn't get the zip / no unzip support: IAP files are optional, so warn and continue.
			for (const name of iapNeeded) missingOptional.push(name);
			note("⚠", `optional IAP files`, ` — ${e.message}`);
		}
	}

	const skipNote = skipped > 0 ? ` (${skipped} already present, skipped — use --force to refresh)` : "";
	console.log(`\nFetched ${ok} asset(s), ${(bytes / 1024 / 1024).toFixed(1)} MB${skipNote}`);
	if (missingOptional.length > 0) {
		console.warn(`Skipped ${missingOptional.length} unavailable file(s): ${[...new Set(missingOptional)].join(", ")}`);
	}
	if (missingRequired > 0) {
		console.error(`${missingRequired} required asset(s) failed to download.`);
		process.exit(1);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
