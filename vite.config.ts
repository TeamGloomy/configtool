import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Prerelease builds (alpha/beta/rc in package.json version) deploy under /beta so the
// stable build at the deploy root stays untouched while the prerelease is reachable in parallel.
const configtoolVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
const isPrerelease = /-(?:alpha|beta|rc)\b/i.test(configtoolVersion);

// Deploy root. Defaults to "/" (Duet's pkg.duet3d.com layout). For GitHub Pages project
// sites the app is served from a subpath (e.g. "/Configurator/"); set CONFIGTOOL_BASE to that.
// Always normalised to start and end with a single "/".
const deployRoot = `/${(process.env.CONFIGTOOL_BASE ?? "/").replace(/^\/+|\/+$/g, "")}/`.replace(/\/{2,}/g, "/");
const baseUrl = isPrerelease ? `${deployRoot}beta/` : deployRoot;

// https://vitejs.dev/config/
export default defineConfig({
	base: baseUrl,
	build: {
		chunkSizeWarningLimit: 5000000,
		rollupOptions: {
			output: {
				// Replace any character that isn't alphanumeric, -, _, . or / so hashes
				// containing Base64 '+' aren't decoded as spaces by GitHub Pages' Nginx.
				sanitizeFileName: (name) => name.replace(/[^\w\-./]/g, "_"),
				chunkFileNames: "js/[name]-[hash].js",
				entryFileNames: "js/[name]-[hash].js",
				
				assetFileNames: ({ name }) => {
					if (name) {
						if (/\.css$/.test(name)) {
							return "css/[name]-[hash][extname]";
						}
						if (/\.(eot|woff|woff2|ttf)$/.test(name)) {
							return "fonts/[name]-[hash][extname]";
						}
						if (/\.(gif|jpe?g|png|svg)$/.test(name)) {
							return "img/[name]-[hash][extname]";
						}
					}
					
					// default value
					// ref: https://rollupjs.org/guide/en/#outputassetfilenames
					return "assets/[name]-[hash][extname]";
				},
				manualChunks: (id) => {
					if (id.includes("monaco")) {
						return "monaco";
					}
					if (id.includes("CheckInput")) {
						return "components";
					}
				}
			}
		}
	},
	plugins: [
		vue()
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			// ejs's ESM build imports node:fs/node:path for its fileLoader code paths;
			// the bundled browser build skips them and trims the build of stub warnings
			"ejs": fileURLToPath(new URL("./node_modules/ejs/ejs.min.js", import.meta.url))
		}
	},
	worker: {
		rollupOptions: {
			output: {
				entryFileNames: "js/[name]-[hash].js"
			}
		}
	}
})
