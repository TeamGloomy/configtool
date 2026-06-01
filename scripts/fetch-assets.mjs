// Downloads the Duet firmware, IAP and DuetWebControl assets that the config tool
// serves from the same-origin /assets/ path at runtime.
//
// Why this exists: GitHub Pages only serves what is in the built site, and these
// binaries are too large/churny to commit to git. GitHub *release* assets can't be
// fetched from the browser (no CORS headers), so they can't be pulled at runtime either.
// Instead CI runs this script before `npm run build` to mirror the files into
// public/assets/, where Vite copies them into dist/assets/ for deployment.
//
// The list of firmware/IAP files is parsed straight out of src/store/Boards.ts so it
// stays in sync with the supported Duet boards automatically.
//
// Note: STM32 / community board firmware is NOT fetched here — it is downloaded live
// from raw.githubusercontent.com (which does send CORS headers) at bundle time.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Base URL of an existing deployment that already serves the assets. Override with
// CONFIGTOOL_ASSET_BASE if Duet ever moves them.
const ASSET_BASE = (process.env.CONFIGTOOL_ASSET_BASE || "https://configtool.reprapfirmware.org/assets").replace(/\/$/, "");

const RRF_DIR = join(repoRoot, "public", "assets", "RepRapFirmware");
const ASSETS_DIR = join(repoRoot, "public", "assets");

/** Pull every firmware/IAP filename referenced by the Duet board definitions. */
function collectFirmwareFiles() {
	const boardsTs = readFileSync(join(repoRoot, "src", "store", "Boards.ts"), "utf8");
	const names = new Set();
	const re = /(?:firmwareFileName|iapFileNameSD|iapFileNameSBC)\s*:\s*"([^"]+)"/g;
	let m;
	while ((m = re.exec(boardsTs)) !== null) {
		names.add(m[1]);
	}
	return [...names].sort();
}

async function download(url, destPath) {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`${res.status} ${res.statusText} for ${url}`);
	}
	const buf = Buffer.from(await res.arrayBuffer());
	mkdirSync(dirname(destPath), { recursive: true });
	writeFileSync(destPath, buf);
	return buf.length;
}

async function main() {
	const firmwareFiles = collectFirmwareFiles();
	console.log(`Found ${firmwareFiles.length} Duet firmware/IAP files referenced in Boards.ts`);

	const jobs = [
		// DuetWebControl bundle (served at /assets/DuetWebControl.zip). Required: the web
		// interface is needed for any standalone bundle, so a miss here fails the build.
		{ url: `${ASSET_BASE}/DuetWebControl.zip`, dest: join(ASSETS_DIR, "DuetWebControl.zip"), required: true },
		// Firmware + IAP files (served at /assets/RepRapFirmware/<name>). Optional: a few
		// older/niche boards (e.g. Duet 2 Maestro) have no published binary on the asset host;
		// the upstream tool ships without them too, so a miss is a warning, not a failure.
		...firmwareFiles.map(name => ({
			url: `${ASSET_BASE}/RepRapFirmware/${name}`,
			dest: join(RRF_DIR, name),
			required: false,
		})),
	];

	let ok = 0, missingRequired = 0, missingOptional = [], bytes = 0;
	for (const job of jobs) {
		try {
			const size = await download(job.url, job.dest);
			bytes += size;
			ok++;
			console.log(`  ✓ ${job.url.replace(ASSET_BASE + "/", "")} (${(size / 1024).toFixed(0)} KB)`);
		} catch (e) {
			if (job.required) {
				missingRequired++;
				console.error(`  ✗ REQUIRED ${job.url} — ${e.message}`);
			} else {
				missingOptional.push(job.url.replace(ASSET_BASE + "/", ""));
				console.warn(`  ⚠ optional ${job.url.replace(ASSET_BASE + "/", "")} — ${e.message}`);
			}
		}
	}

	console.log(`\nFetched ${ok}/${jobs.length} assets (${(bytes / 1024 / 1024).toFixed(1)} MB total)`);
	if (missingOptional.length > 0) {
		console.warn(`Skipped ${missingOptional.length} unavailable firmware file(s): ${missingOptional.join(", ")}`);
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
