<template>
	<config-section board-txt :type="ConfigSectionType.Accessories" title="Accessories" url-title="Duet3D Accessories"
					url="https://docs.duet3d.com/en/Duet3D_hardware/Accessories">
		<div class="row">
			<!-- Direct Display -->
			<div class="col-auto">
				<check-input v-if="(store.data.boards.length > 0) && store.data.boards[0].supportsDirectDisplay"
							 label="Enable Direct Display"
							 title="Check this option if you have a direct display connected to your Duet (like a 12864 or TFT display)"
							 v-model="configureDirectDisplay"
							 :preset="(store.preset.boards.length > 0) && (store.preset.boards[0].directDisplay !== null)" />
			</div>
			<!-- STM32 12864 display (RepRapDiscount Full Graphic on EXP3 / SPI channel 5) -->
			<div v-if="supports12864" class="col-12">
				<check-input label="Enable 12864 display (RepRapDiscount Full Graphic)"
							 title="Check this if you have a RepRapDiscount Full Graphic Smart Controller connected to the EXP1/EXP3 headers. Uses SPI channel 5."
							 v-model="store.data.configTool.stm32Display12864" :preset="false" />
				<div v-if="store.data.configTool.stm32Display12864" class="alert alert-info mb-0 mt-2 py-2 small">
					<i class="bi-info-circle me-1"></i>
					Connects via the EXP1/EXP3 headers on <strong>SPI channel 5</strong> (reserved for the display
					in the <a href="#spiConfig">SPI Configuration</a> section). The encoder, button and CS pins are
					fixed on these headers, so no pin selection is needed.
				</div>
			</div>
			<div class="col-12">
				<div v-if="configureDirectDisplay" class="row ms-3 my-2">
					<div class="col-6">
						<select-input label="Direct display type" title="Type of the connected display"
									  v-model="directDisplayController" :options="DirectDisplayTypes"
									  :preset="(store.preset.boards.length > 0) ? store.preset.boards[0].directDisplay?.screen.controller : null" />
					</div>
					<div v-if="store.data.boards[0].directDisplay?.encoder" class="col-3">
						<select-input label="Encoder pulses per click" title="Number of pulses per encoder turn"
									  v-model="store.data.boards[0].directDisplay!.encoder!.pulsesPerClick"
									  :options="PulsesPerClick"
									  :preset="(store.preset.boards.length > 0) ? store.preset.boards[0].directDisplay?.encoder?.pulsesPerClick : null" />
					</div>
					<div class="col-3">
						<number-input label="SPI frequency" title="Frequency of the SPI link"
									  v-model="store.data.boards[0].directDisplay!.screen.spiFreq"
									  :preset="(store.preset.boards.length > 0) ? store.preset.boards[0].directDisplay?.screen.spiFreq : null"
									  unit="Hz" :min="100000" :max="8000000" :step="1" />
					</div>
				</div>
				<div v-if="store.data.boards[0].directDisplay?.screen.controller === DirectDisplayController.ST7567"
					 class="row ms-3 my-2">
					<div class="col">
						<number-input label="Contrast ratio" title="Contrast ratio of this display"
									  v-model="(store.data.boards[0].directDisplay!.screen as DirectDisplayScreenST7567).contrast"
									  :preset="(store.preset.boards.length > 0) ? (store.preset.boards[0].directDisplay?.screen as DirectDisplayScreenST7567 | null)?.contrast : null"
									  :min="0" :max="100" :step="1" />
					</div>
					<div class="col">
						<number-input label="Resistor ratio" title="Resistor ratio of this display"
									  v-model="(store.data.boards[0].directDisplay!.screen as DirectDisplayScreenST7567).resistorRatio"
									  :preset="(store.preset.boards.length > 0) ? (store.preset.boards[0].directDisplay?.screen as DirectDisplayScreenST7567 | null)?.resistorRatio : null"
									  :min="1" :max="7" :step="1" />
					</div>
				</div>
			</div>
			<!-- STM32 Serial Port Configuration -->
			<template v-if="hasSTM32SerialOptions">
				<div class="col-12 mt-3">
					<strong>STM32 Serial Ports</strong>
					<div class="text-muted small mb-2">
						Configures <code>serial.aux.rxTxPins</code> / <code>serial.aux2.rxTxPins</code> in board.txt.
						Select the physical header you are using for each serial port.
					</div>
					<div class="row">
						<div class="col-auto">
							<select-input label="AUX Serial (serial.aux)"
										  title="Physical connector to use for the primary auxiliary serial port (e.g. PanelDue)"
										  v-model="stm32AuxSerial" :options="stm32AuxOptions" :preset="stm32AuxPreset" />
						</div>
						<div class="col-auto">
							<select-input label="AUX2 Serial (serial.aux2)"
										  title="Physical connector to use for the secondary auxiliary serial port"
										  v-model="stm32Aux2Serial" :options="stm32Aux2Options" :preset="stm32Aux2Preset" />
						</div>
					</div>
				</div>
			</template>
			<!-- PanelDue -->
			<div class="col-auto">
				<check-input v-if="panelDueChannels.length > 0" class="mt-1" label="Enable PanelDue"
							 title="Check this option if you have a PanelDue connected to your Duet"
							 :model-value="store.data.panelDueChannel >= 0"
							 @update:model-value="store.data.panelDueChannel = $event ? panelDueChannels[0].value : -1"
							 :preset="store.preset.panelDueChannel >= 0" />
			</div>
			<div class="col-12">
				<div v-if="(panelDueChannels.length > 0) && (store.data.panelDueChannel >= 0)" class="row ms-3 mt-2">
					<div class="col-6">
						<select-input label="UART Channel" title="Channel number to use for PanelDue"
									  v-model="store.data.panelDueChannel" :preset="store.preset.panelDueChannel"
									  :options="panelDueChannels" />
					</div>
					<div class="col-3">
						<select-input label="Baud rate"
									  title="Baud rate for communication. This value must match the setting on PanelDue"
									  v-model="store.data.configTool.panelDueBaudRate"
									  :preset="store.preset.configTool.panelDueBaudRate" :options="BaudRates" />
					</div>
					<div class="col-3 d-flex align-items-end">
						<check-input label="Require checksum"
									 title="Enable checksums for PanelDue communication. Recommended if your cable is long"
									 v-model="store.data.configTool.panelDueChecksum"
									 :preset="store.preset.configTool.panelDueChecksum" />
					</div>
				</div>
			</div>
		</div>
	</config-section>
</template>

<script lang="ts">
import type { SelectOption } from "@/components/inputs/SelectInput.vue";
import { ConfigSectionType } from "@/store/sections";
import { getBoardDefinition } from "@/store/Boards";
import { ConfigPortFunction } from "@/store/model/ConfigPort";

const DirectDisplayTypes: Array<SelectOption> = [
	{
		text: "ST7920 (RepRapDiscount Full Graphic Smart Controller)",
		value: DirectDisplayController.ST7920
	},
	{
		text: "ST7567 (Fysetc Mini 12864 Panel)",
		value: DirectDisplayController.ST7567
	},
	{
		disabled: true,
		text: "ILI9488 (not yet officially supported)",
		value: DirectDisplayController.ILI9488
	}
];

const PulsesPerClick: Array<SelectOption> = [
	{
		text: "-4",
		value: -4
	},
	{
		text: "-2",
		value: -2
	},
	{
		text: "-1",
		value: -1
	},
	{
		text: "1",
		value: 1
	},
	{
		text: "2",
		value: 2
	},
	{
		text: "4",
		value: 4
	},
];

const BaudRates: Array<SelectOption> = [
	{
		text: "9600",
		value: 9600
	},
	{
		text: "19200",
		value: 19200
	},
	{
		text: "38400",
		value: 38400
	},
	{
		text: "57600",
		value: 57600
	},
	{
		text: "115200",
		value: 115200
	}
];
</script>
					 
<script setup lang="ts">
import { Board, DirectDisplay, DirectDisplayController, DirectDisplayScreenST7567, LedStrip, LedStripType, initObject } from "@duet3d/objectmodel";
import { computed } from "vue";

import ConfigSection from "@/components/ConfigSection.vue";
import CheckInput from "@/components/inputs/CheckInput.vue";
import SelectInput from "@/components/inputs/SelectInput.vue";
import NumberInput from "@/components/inputs/NumberInput.vue";

import { isSTM32BoardType, getBoardTxtDefault, type STM32BoardDescriptor } from "@/store/STM32Boards";
import { useStore } from "@/store";

const store = useStore();

// Direct Display
const configureDirectDisplay = computed({
	get() { return (store.data.boards.length > 0) && store.data.boards[0].supportsDirectDisplay && (store.data.boards[0].directDisplay !== null); },
	set(value) { store.data.boards[0].directDisplay = value ? new DirectDisplay() : null; }
});

const directDisplayController = computed({
	get() { return (store.data.boards.length > 0) && store.data.boards[0].directDisplay!.screen.controller; },
	set(value) {
		store.data.boards[0].directDisplay!.update({ screen: { controller: value } });

		// ST7567 displays require a Dotstar LED strip
		if (value === DirectDisplayController.ST7567) {
			const boardDefinition = getBoardDefinition(store.data);
			if (boardDefinition !== null && boardDefinition.displayDotstarPort !== null &&
				!store.data.configTool.ports.some(item => item.equals(boardDefinition.displayDotstarPort!) && item.function === ConfigPortFunction.ledStrip) &&
				(store.data.limits.ledStrips ?? 0) > 0)
			{
				const portInstance = store.data.configTool.assignPort(boardDefinition.displayDotstarPort, ConfigPortFunction.ledStrip, 0);
				if (store.data.ledStrips.length === 0) {
					store.data.ledStrips.push(initObject(LedStrip, {
						board: portInstance.canBoard ?? 0,
						pin: portInstance.rawPorts[0],
						type: LedStripType.DotStar
					}));
				} else {
					store.data.ledStrips[0].update({
						board: portInstance.canBoard ?? 0,
						pin: portInstance.rawPorts[0],
						type: LedStripType.DotStar
					});
				}
			}
		}
	}
});

// STM32 Serial Ports
const stm32BoardDef = computed(() => {
	const bt = store.data.boardType;
	if (bt !== null && isSTM32BoardType(bt)) {
		return store.data.boardDefinition as STM32BoardDescriptor | null;
	}
	return null;
});

// True when the board has at least one UART option in the pool
const hasSTM32SerialOptions = computed(() => (stm32BoardDef.value?.serialOptions.length ?? 0) > 0);

// True when the board supports a RepRapDiscount Full Graphic 12864 display (EXP3 / SPI channel 5)
const supports12864 = computed(() => stm32BoardDef.value?.supports12864 ?? false);

const stm32AuxSerial = computed({
	get() { return store.data.configTool.stm32AuxSerial; },
	set(v: string) { store.data.configTool.stm32AuxSerial = v; }
});
const stm32Aux2Serial = computed({
	get() { return store.data.configTool.stm32Aux2Serial; },
	set(v: string) { store.data.configTool.stm32Aux2Serial = v; }
});

// Build dropdown options from the shared pool, excluding whatever is already
// selected for the *other* port so the same UART can't be used twice.
function buildPool(pool: STM32BoardDescriptor["serialOptions"], exclude: string): Array<SelectOption> {
	const result: Array<SelectOption> = [{ text: "None (disabled)", value: "" }];
	for (const opt of pool) {
		const val = `${opt.rx},${opt.tx}`;
		if (val !== exclude) {
			result.push({ text: opt.label, value: val });
		}
	}
	return result;
}

const stm32AuxOptions  = computed(() =>
	stm32BoardDef.value ? buildPool(stm32BoardDef.value.serialOptions, stm32Aux2Serial.value) : []
);
const stm32Aux2Options = computed(() =>
	stm32BoardDef.value ? buildPool(stm32BoardDef.value.serialOptions, stm32AuxSerial.value)  : []
);

// Presets reflect the board's actual defaults (rrfboot value, else firmware default A.10,A.9 for aux)
const stm32AuxPreset = computed(() => {
	if (!stm32BoardDef.value) return "";
	const def = getBoardTxtDefault(stm32BoardDef.value.boardTxtContent, "serial.aux.rxTxPins") ?? "A.10,A.9";
	return /nopin/i.test(def) ? "" : def;
});
const stm32Aux2Preset = computed(() => {
	if (!stm32BoardDef.value) return "";
	const def = getBoardTxtDefault(stm32BoardDef.value.boardTxtContent, "serial.aux2.rxTxPins");
	return (def && !/nopin/i.test(def)) ? def : "";
});

// PanelDue
const panelDueChannels = computed(() => {
	const result: Array<SelectOption> = [];

	// For STM32 boards, build channel list from whichever serial ports are configured
	if (stm32BoardDef.value !== null) {
		if (store.data.configTool.stm32AuxSerial) {
			result.push({ text: "Channel 0 (serial.aux)", value: 0 });
		}
		if (store.data.configTool.stm32Aux2Serial) {
			result.push({ text: "Channel 1 (serial.aux2)", value: 1 });
		}
		return result;
	}

	// Duet boards — existing behaviour
	if (store.data.boardDefinition !== null) {
		for (let i = 0; i < store.data.boardDefinition.ports.uart.length; i++) {
			if (store.data.boardDefinition.ports.uart[i] !== "usb") {
				result.push({
					text: `Channel ${i} (${store.data.boardDefinition.ports.uart[i]})`,
					value: i
				});
			}
		}
	}
	return result;
});
</script>
