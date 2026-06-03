<style scoped>
/* Free-layout mode: panels become absolutely positioned draggable cards. In the default
   (stack) mode nothing here applies, so the normal document flow is preserved. */
.panel-canvas.free {
	position: relative;
}

.panel-canvas :deep(.card-header) {
	cursor: grab;
}

.panel-canvas.dragging {
	user-select: none;
}

.panel-canvas.dragging :deep(.card-header) {
	cursor: grabbing;
}
</style>

<template>
	<main class="container">
		<div class="panel-canvas" :class="{ free: layoutEnabled, dragging: isDragging }" :style="canvasStyle"
			 ref="canvasRef">
			<div v-for="entry in panels" :key="entry.type" class="panel" :style="panelStyle(entry.type)"
				 :ref="(el) => registerPanel(entry.type, el as HTMLElement | null)"
				 @pointerdown="onPointerDown(entry.type, $event)">
				<component :is="entry.component" />
			</div>
		</div>

		<div class="mt-3"></div>

		<div v-if="layoutEnabled" class="d-flex justify-content-center mb-3">
			<button type="button" class="btn btn-outline-secondary btn-sm" @click.prevent="resetLayout">
				<i class="bi bi-arrow-counterclockwise"></i>
				Reset panel layout
			</button>
		</div>

		<div v-if="firstErrorNode !== null" class="alert alert-danger d-flex justify-content-between mt-2">
			<span>
				<i class="bi bi-exclamation-triangle"></i>
				Your configuration contains errors. You must fix them before you can continue.
			</span>
			<a href="javascript:void(0)" @click.prevent="jumpToFirstError">
				<i class="bi bi-arrow-up-circle"></i>
				Jump to first error
			</a>
		</div>

		<div class="d-flex justify-content-center mb-3">
			<button type="button" class="btn btn-lg btn-primary ms-1" :disabled="firstErrorNode !== null" @click.prevent="router.push('/Summary')">
				<i class="bi bi-arrow-right-circle"></i>
				Finish Configuration
			</button>
		</div>
	</main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, reactive, ref, watch, type Component } from "vue";
import { useRouter } from "vue-router";

import { ConfigSectionType, getSections } from "@/store/sections";
import General from "@/components/sections/General.vue";
import Accessories from "@/components/sections/Accessories.vue";
import Network from "@/components/sections/Network.vue";
import LedStrips from "@/components/sections/LedStrips.vue";
import Expansion from "@/components/sections/Expansion.vue";
import SpiConfig from "@/components/sections/SpiConfig.vue";
import Accelerometers from "@/components/sections/Accelerometers.vue";
import Kinematics from "@/components/sections/Kinematics.vue";
import Drivers from "@/components/sections/Drivers.vue";
import Axes from "@/components/sections/Axes.vue";
import Extruders from "@/components/sections/Extruders.vue";
import FilamentMonitors from "@/components/sections/FilamentMonitors.vue";
import Probes from "@/components/sections/Probes.vue";
import Endstops from "@/components/sections/Endstops.vue";
import Compensation from "@/components/sections/Compensation.vue";
import Sensors from "@/components/sections/Sensors.vue";
import Heaters from "@/components/sections/Heaters.vue";
import Spindles from "@/components/sections/Spindles.vue";
import Lasers from "@/components/sections/Lasers.vue";
import Fans from "@/components/sections/Fans.vue";
import Tools from "@/components/sections/Tools.vue";
import Miscellaneous from "@/components/sections/Miscellaneous.vue";

const router = useRouter();

// Sections
const componentMap: Record<ConfigSectionType, Component> = {
	[ConfigSectionType.General]: General,
	[ConfigSectionType.Accessories]: Accessories,
	[ConfigSectionType.LedStrips]: LedStrips,
	[ConfigSectionType.Network]: Network,
	[ConfigSectionType.Expansion]: Expansion,
	[ConfigSectionType.SpiConfig]: SpiConfig,
	[ConfigSectionType.Accelerometers]: Accelerometers,
	[ConfigSectionType.Kinematics]: Kinematics,
	[ConfigSectionType.Drivers]: Drivers,
	[ConfigSectionType.Axes]: Axes,
	[ConfigSectionType.Extruders]: Extruders,
	[ConfigSectionType.FilamentMonitors]: FilamentMonitors,
	[ConfigSectionType.Probes]: Probes,
	[ConfigSectionType.Endstops]: Endstops,
	[ConfigSectionType.Compensation]: Compensation,
	[ConfigSectionType.Sensors]: Sensors,
	[ConfigSectionType.Heaters]: Heaters,
	[ConfigSectionType.Spindles]: Spindles,
	[ConfigSectionType.Lasers]: Lasers,
	[ConfigSectionType.Fans]: Fans,
	[ConfigSectionType.Tools]: Tools,
	[ConfigSectionType.Miscellaneous]: Miscellaneous
};

const panels = computed(() => getSections().map(type => ({ type, component: componentMap[type] })));

// ---- Free panel layout ----------------------------------------------------------------
// Panels can be dragged anywhere by their title bar. When the user starts dragging, every
// panel's current (stacked) position is captured and the layout switches to free positioning,
// so there is no visual jump. The arrangement is persisted to localStorage.
interface PanelPosition { x: number; y: number; w: number; z: number; }
const STORAGE_KEY = "configtool.panelLayout";

const layoutEnabled = ref(false);
const positions = reactive<Record<string, PanelPosition>>({});
const panelSizes = reactive<Record<string, { w: number; h: number }>>({});
const maxZ = ref(1);
const isDragging = ref(false);

const canvasRef = ref<HTMLElement | null>(null);
const panelEls = new Map<string, HTMLElement>();
const resizeObserver = (typeof ResizeObserver !== "undefined")
	? new ResizeObserver(entries => {
		for (const e of entries) {
			for (const [type, el] of panelEls) {
				if (el === e.target) {
					panelSizes[type] = { w: el.offsetWidth, h: el.offsetHeight };
					break;
				}
			}
		}
	})
	: null;

function registerPanel(type: string, el: HTMLElement | null) {
	const previous = panelEls.get(type);
	if (previous && previous !== el) {
		resizeObserver?.unobserve(previous);
	}
	if (el) {
		panelEls.set(type, el);
		resizeObserver?.observe(el);
		panelSizes[type] = { w: el.offsetWidth, h: el.offsetHeight };
	} else {
		panelEls.delete(type);
	}
}

function defaultPanelWidth(): number {
	return canvasRef.value?.clientWidth || 720;
}

// The canvas grows to contain all panels so the page can scroll to reach them.
const canvasStyle = computed(() => {
	if (!layoutEnabled.value) {
		return {};
	}
	let right = 0, bottom = 0;
	for (const { type } of panels.value) {
		const p = positions[type];
		if (!p) {
			continue;
		}
		const size = panelSizes[type];
		right = Math.max(right, p.x + (size?.w ?? p.w));
		bottom = Math.max(bottom, p.y + (size?.h ?? 0));
	}
	return { width: `${right + 24}px`, height: `${bottom + 24}px` };
});

function panelStyle(type: string) {
	if (!layoutEnabled.value) {
		return {};
	}
	const p = positions[type];
	if (!p) {
		return { position: "absolute" as const, visibility: "hidden" as const };
	}
	return {
		position: "absolute" as const,
		left: `${p.x}px`,
		top: `${p.y}px`,
		width: `${p.w}px`,
		zIndex: p.z
	};
}

// Capture every panel's current position relative to the canvas, then switch to free mode.
function captureAndEnable() {
	const canvas = canvasRef.value;
	if (!canvas) {
		return;
	}
	const canvasRect = canvas.getBoundingClientRect();
	for (const { type } of panels.value) {
		const el = panelEls.get(type);
		if (!el) {
			continue;
		}
		const rect = el.getBoundingClientRect();
		positions[type] = {
			x: Math.round(rect.left - canvasRect.left),
			y: Math.round(rect.top - canvasRect.top),
			w: Math.round(rect.width),
			z: ++maxZ.value
		};
	}
	layoutEnabled.value = true;
}

// Ensure every visible panel has a position once free mode is active (covers sections that
// appear later, e.g. when CNC/laser capabilities are toggled on).
watch([layoutEnabled, () => panels.value.map(p => p.type).join(",")], () => {
	if (!layoutEnabled.value) {
		return;
	}
	let bottom = 0;
	for (const type in positions) {
		bottom = Math.max(bottom, positions[type].y + (panelSizes[type]?.h ?? 0));
	}
	let added = false;
	for (const { type } of panels.value) {
		if (!positions[type]) {
			positions[type] = { x: 0, y: bottom + 16, w: defaultPanelWidth(), z: ++maxZ.value };
			bottom = positions[type].y + 240;
			added = true;
		}
	}
	if (added) {
		saveLayout();
	}
});

// Dragging (pointer-based so it works for mouse and touch). A small movement threshold avoids
// turning a click on the title bar into an accidental move.
let pending: { type: string; px: number; py: number } | null = null;
let drag: { type: string; startX: number; startY: number; px: number; py: number } | null = null;

function onPointerDown(type: string, event: PointerEvent) {
	if (event.button !== 0) {
		return;
	}
	const target = event.target as HTMLElement;
	if (!target.closest(".card-header")) {
		return;		// only the title bar is a drag handle
	}
	if (target.closest("a, button, input, select, textarea, label")) {
		return;		// let interactive controls in the header work normally
	}
	pending = { type, px: event.clientX, py: event.clientY };
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(event: PointerEvent) {
	if (drag) {
		const p = positions[drag.type];
		if (p) {
			p.x = Math.max(0, Math.round(drag.startX + (event.clientX - drag.px)));
			p.y = Math.max(0, Math.round(drag.startY + (event.clientY - drag.py)));
		}
		event.preventDefault();
		return;
	}
	if (pending) {
		if (Math.hypot(event.clientX - pending.px, event.clientY - pending.py) < 5) {
			return;
		}
		if (!layoutEnabled.value) {
			captureAndEnable();
		}
		const p = positions[pending.type];
		if (p) {
			p.z = ++maxZ.value;
			drag = { type: pending.type, startX: p.x, startY: p.y, px: pending.px, py: pending.py };
			isDragging.value = true;
		}
		pending = null;
		event.preventDefault();
	}
}

function onPointerUp() {
	window.removeEventListener("pointermove", onPointerMove);
	window.removeEventListener("pointerup", onPointerUp);
	if (drag) {
		drag = null;
		isDragging.value = false;
		saveLayout();
	}
	pending = null;
}

function resetLayout() {
	layoutEnabled.value = false;
	for (const key in positions) {
		delete positions[key];
	}
	localStorage.removeItem(STORAGE_KEY);
}

function saveLayout() {
	if (!layoutEnabled.value) {
		localStorage.removeItem(STORAGE_KEY);
		return;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify({
		enabled: true,
		maxZ: maxZ.value,
		positions
	}));
}

function loadLayout() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (!saved) {
			return;
		}
		const data = JSON.parse(saved);
		if (data && data.enabled && data.positions) {
			maxZ.value = data.maxZ ?? 1;
			for (const type in data.positions) {
				positions[type] = data.positions[type];
			}
			layoutEnabled.value = true;
		}
	} catch {
		// Ignore corrupt layout data
	}
}
loadLayout();

// Scrollspy
const observer = new IntersectionObserver(entries => {
	entries.forEach(entry => {
		const id = entry.target.getAttribute("id");
		if (id === "general") {
			if (entry.isIntersecting) {
				document.querySelectorAll(`a[href$="/Configuration"]`).forEach(item => item.classList.add("active"));
			} else {
				document.querySelectorAll(`a[href$="/Configuration"]`).forEach(item => item.classList.remove("active"));
			}
		} else {
			if (entry.isIntersecting) {
				document.querySelectorAll(`a[href$="#${id}"]`).forEach(item => item.classList.add("active"));
			} else {
				document.querySelectorAll(`a[href$="#${id}"]`).forEach(item => item.classList.remove("active"));
			}
		}
	});
}, { rootMargin: "-59px 0px -16px 0px" });

// Error handling
const firstErrorNode = ref<HTMLElement | null>(null);

const classObserver = new MutationObserver(() => {
	firstErrorNode.value = document.body.querySelector(".is-invalid");
});

function jumpToFirstError() {
	if (firstErrorNode.value !== null) {
		const container = firstErrorNode.value.closest("section[id]");
		if (container !== null) {
			// Go to section containing the error
			router.push("/Configuration#" + container.id);
		}
	}
}

// Component lifecycle
onMounted(() => {
	// Track all sections that have an `id` applied
	document.querySelectorAll("section[id]").forEach((section) => {
		observer.observe(section);
	});

	// Track inputs changing their class to is-invalid
	classObserver.observe(document.body, {
		attributes: true,
		attributeFilter: ['class'],
		childList: true,
		subtree: true
	});
});

onBeforeUnmount(() => {
	// Stop tracking
	observer.disconnect();
	classObserver.disconnect();
	resizeObserver?.disconnect();
	window.removeEventListener("pointermove", onPointerMove);
	window.removeEventListener("pointerup", onPointerUp);
});
</script>
