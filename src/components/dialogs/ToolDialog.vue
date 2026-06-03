<style scoped>
.macro-editor {
	font-family: var(--bs-font-monospace);
	font-size: 0.85rem;
	white-space: pre;
	tab-size: 4;
}
</style>

<template>
	<base-dialog :title="`Advanced Settings for Tool ${toolName}`" :model-value="props.modelValue"
				 size="lg" scrollable @update:model-value="emit('update:modelValue', $event)">
		<div v-if="tool" class="row">
			<!-- TODO XY axis mapping, heater feedforward,  -->
			<div class="col-12">
				Axis Offsets:
				<div v-for="(axis, index) in store.data.move.axes" class="row mt-2">
					<label class="col-sm-auto col-form-label">
						{{ axis.letter }}:
					</label>
					<div class="col-sm">
						<number-input :title="`${axis.letter} axis offset`" :model-value="getOffset(index)"
									  @update:model-value="setOffset(index, $event)" :step="0.001" unit="mm" />
					</div>
				</div>
			</div>

			<!-- Tool change macros -->
			<div class="col-12 mt-4">
				<h6>Tool Change Macros</h6>
				<p class="text-muted small mb-2">
					Optional commands for this tool's change macros. They are run in addition to anything the
					Config Tool already generates (for example the temperature wait in tpost).
				</p>

				<label class="form-label mb-1">
					<code>tpre{{ tool.number }}.g</code> &mdash; before tool {{ tool.number }} is selected
				</label>
				<textarea class="form-control macro-editor mb-3" rows="4" spellcheck="false"
						  placeholder="; e.g. move to a safe position before the change"
						  v-model="toolPre"></textarea>

				<label class="form-label mb-1">
					<code>tpost{{ tool.number }}.g</code> &mdash; after tool {{ tool.number }} is selected
				</label>
				<textarea class="form-control macro-editor mb-3" rows="4" spellcheck="false"
						  placeholder="; e.g. purge / prime the nozzle after the change"
						  v-model="toolPost"></textarea>

				<label class="form-label mb-1">
					<code>tfree{{ tool.number }}.g</code> &mdash; when tool {{ tool.number }} is freed
				</label>
				<textarea class="form-control macro-editor mb-0" rows="4" spellcheck="false"
						  placeholder="; e.g. park the tool / wipe the nozzle"
						  v-model="toolFree"></textarea>
			</div>
		</div>
		<div v-else class="text-danger">
			error, no tool selected
		</div>
	</base-dialog>
</template>

<script setup lang="ts">
import type { Tool } from "@duet3d/objectmodel";
import { computed } from "vue";

import BaseDialog from "./BaseDialog.vue";
import NumberInput from "@/components/inputs/NumberInput.vue";

import { useStore } from "@/store";
import type { ModelDictionary } from "@duet3d/objectmodel";

const props = defineProps<{
	modelValue: boolean,
	tool: Tool | null
}>();
const emit = defineEmits<{
	(e: "update:modelValue", value: boolean): void
}>();

const store = useStore();

const toolName = computed(() => props.tool ? (props.tool.name ? props.tool.name : `#${props.tool.number}`) : "n/a");

// Tool Offset
function getOffset(index: number) {
	return (props.tool !== null && index < props.tool.offsets.length) ? props.tool.offsets[index] : 0;
}

function setOffset(index: number, value: number) {
	if (props.tool !== null) {
		while (index >= props.tool.offsets.length) {
			props.tool.offsets.push(0);
		}
		props.tool.offsets[index] = value;
	}
}

// Tool change macro custom content. Stored per tool number; null clears the entry.
function macroEditor(dictionary: () => ModelDictionary<string>) {
	return computed<string>({
		get() {
			return (props.tool !== null) ? (dictionary().get(props.tool.number.toString()) ?? "") : "";
		},
		set(value: string) {
			if (props.tool !== null) {
				dictionary().set(props.tool.number.toString(), value.trim() === "" ? null : value);
			}
		}
	});
}

const toolPre = macroEditor(() => store.data.configTool.toolPreCommands);
const toolPost = macroEditor(() => store.data.configTool.toolPostCommands);
const toolFree = macroEditor(() => store.data.configTool.toolFreeCommands);
</script>
