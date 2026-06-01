<style scoped>
.nav-tabs {
	padding-top: 9px;
	padding-left: 9px;
}

.preview-visible {
	border-bottom-right-radius: 0;
	border-bottom-left-radius: 0;
}
</style>

<template>
	<div class="card" :class="previewVisible ? 'preview-visible' : ''" v-bind="$attrs">
		<!-- Card Title-->
		<div class="card-header d-flex justify-content-between align-items-center">
			<slot name="title">
				{{ props.title }}
			</slot>

			<a v-if="previewTemplates && previewTemplates.length > 0" href="javascript:void(0)" @click="toggleGcodePreview">
				<i class="bi" :class="previewVisible ? 'bi-code-slash' : 'bi-code'"></i>
				{{ previewVisible? "Hide G-code preview": "Show G-code preview" }}
			</a>

			<a v-if="showBoardTxtPreview" href="javascript:void(0)" @click="toggleBoardTxtPreview">
				<i class="bi" :class="boardTxtVisible ? 'bi-file-earmark-text-fill' : 'bi-file-earmark-text'"></i>
				{{ boardTxtVisible ? "Hide board.txt preview" : "Show board.txt preview" }}
			</a>

			<a v-if="props.url && props.urlTitle" :href="props.url" target="_blank">
				<i class="bi-info-circle"></i>
				{{ props.urlTitle }}
			</a>

			<slot name="append-title" />
		</div>

		<!-- Card Content-->
		<template v-if="previewVisible">
			<ul class="nav nav-tabs">
				<li v-for="template in props.previewTemplates" class="nav-item">
					<a class="nav-link" :class="(template === selectedTemplate) ? 'active' : ''"
					   href="javascript:void(0)" @click="selectedTemplate = template">
						{{ template.split('/')[0] + ".g" }}
					</a>
				</li>
				<a v-if="!previewRendering" class="align-self-center ms-auto me-3 text-decoration-none" href="javascript:void(0)" @click.prevent="showFile">
					<i :class="fileRendering ? 'bi-hourglass' : 'bi-box-arrow-in-up-right'"></i>
					{{ fileRendering ? "rendering..." : "view full file" }}
				</a>
			</ul>
			<g-code-output v-show="previewVisible" class="output" :value="generatedCode" readonly />
		</template>
		<template v-else-if="boardTxtVisible">
			<ul class="nav nav-tabs">
				<li class="nav-item">
					<a class="nav-link active" href="javascript:void(0)">board.txt</a>
				</li>
				<a class="align-self-center ms-auto me-3 text-decoration-none" href="javascript:void(0)" @click.prevent="showBoardTxtFile">
					<i :class="boardTxtFileRendering ? 'bi-hourglass' : 'bi-box-arrow-in-up-right'"></i>
					{{ boardTxtFileRendering ? "rendering..." : "view full file" }}
				</a>
			</ul>
			<g-code-output class="output" :value="boardTxtCode" readonly />
		</template>
		<template v-else-if="!keepAlive">
			<slot name="body" />
			<div v-if="hasSlotContent($slots.default)" class="card-body">
				<slot />
			</div>
			<slot name="append" />
		</template>
		<div v-if="keepAlive" v-show="!previewVisible && !boardTxtVisible">
			<slot name="body" />
			<div v-if="hasSlotContent($slots.default)" class="card-body">
				<slot />
			</div>
			<slot name="append" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { Comment, computed, defineAsyncComponent, ref, watch, type Slot, type VNode } from "vue";

import { indent, render, renderToNewTab } from "@/store/render";
import { useStore } from "@/store";
import { isSTM32BoardType } from "@/store/STM32Boards";

const GCodeOutput = defineAsyncComponent(() => import("./monaco/GCodeOutput.vue"));

const props = defineProps<{
	title?: string,
	keepAlive?: boolean,
	previewTemplates?: Array<string> | null,
	previewOptions?: Record<string, any> | Array<Record<string, any> | null> | null,
	url?: string
	urlTitle?: string,
	/** Opt this card in to a board.txt preview link (only shown for STM32 boards) */
	boardTxt?: boolean
}>();

const store = useStore();

// board.txt only exists for STM32 boards; the link is opt-in per section via the boardTxt prop
const showBoardTxtPreview = computed(() =>
	!!props.boardTxt && store.data.boardType !== null && isSTM32BoardType(store.data.boardType as string)
);

// Credits go to https://github.com/vuejs/core/issues/4733#issuecomment-1024816095
function hasSlotContent(slot: Slot | undefined, slotProps = {}): boolean {
	if (!slot) return false;

	return slot(slotProps).some((vnode: VNode) => {
		if (vnode.type === Comment) return false;

		if (Array.isArray(vnode.children) && !vnode.children.length) return false;

		return (
			vnode.type !== Text
			|| (typeof vnode.children === "string" && vnode.children.trim() !== "")
		);
	});
}

// Preview
const previewVisible = ref(false);
const boardTxtVisible = ref(false);
const selectedTemplate = ref<string>((props.previewTemplates && props.previewTemplates.length > 0) ? props.previewTemplates[0] : "");

// The two previews are mutually exclusive so only one output is shown at a time
function toggleGcodePreview() {
	previewVisible.value = !previewVisible.value;
	if (previewVisible.value) {
		boardTxtVisible.value = false;
	}
}
function toggleBoardTxtPreview() {
	boardTxtVisible.value = !boardTxtVisible.value;
	if (boardTxtVisible.value) {
		previewVisible.value = false;
	}
}

// Partial preview
const generatedCode = ref(""), previewRendering = ref(false);

const renderArgs = computed(() => {
	let renderArgs;
	if (props.previewOptions instanceof Array && props.previewTemplates) {
		const index = props.previewTemplates.indexOf(selectedTemplate.value);
		renderArgs = { ...props.previewOptions[index], preview: true };
	} else if (props.previewOptions) {
		renderArgs = { ...props.previewOptions, preview: true };
	} else {
		renderArgs = { preview: true };
	}
	return renderArgs;
});

watch(() => props.previewTemplates, () => {
	if (!props.previewTemplates || props.previewTemplates?.length === 0) {
		selectedTemplate.value = "";
		if (previewVisible.value) {
			previewVisible.value = false;
		}
	} else if (selectedTemplate.value === "") {
		selectedTemplate.value = props.previewTemplates[0];
	}
});

watch(() => previewVisible.value && selectedTemplate.value, async () => {
	if (previewVisible.value && props.previewTemplates) {
		if (previewRendering.value) {
			return;
		}
		previewRendering.value = true;

		generatedCode.value = "rendering...";
		try {
			const content = await render(selectedTemplate.value, renderArgs.value);
			generatedCode.value = indent(content);
		} catch (e) {
			console.warn(e);
			generatedCode.value = "failed to render G-code:\n" + e;
		}
		previewRendering.value = false;
	}
});

// Full preview
const fileRendering = ref(false);
async function showFile() {
	if (fileRendering.value) {
		return;
	}
	fileRendering.value = true;

	try {
		await renderToNewTab(selectedTemplate.value, renderArgs.value);
	} catch (e) {
		alert(`Failed to generate file:\n\n${e}`);
	}
	fileRendering.value = false;
}

// board.txt preview
const boardTxtCode = ref(""), boardTxtRendering = ref(false), boardTxtFileRendering = ref(false);

watch(boardTxtVisible, async () => {
	if (boardTxtVisible.value) {
		if (boardTxtRendering.value) {
			return;
		}
		boardTxtRendering.value = true;

		boardTxtCode.value = "rendering...";
		try {
			boardTxtCode.value = await render("boardtxt", { preview: true });
		} catch (e) {
			console.warn(e);
			boardTxtCode.value = "failed to render board.txt:\n" + e;
		}
		boardTxtRendering.value = false;
	}
});

async function showBoardTxtFile() {
	if (boardTxtFileRendering.value) {
		return;
	}
	boardTxtFileRendering.value = true;

	try {
		await renderToNewTab("boardtxt", { preview: true });
	} catch (e) {
		alert(`Failed to generate file:\n\n${e}`);
	}
	boardTxtFileRendering.value = false;
}
</script>
