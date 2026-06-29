<style>
.table-external-drivers input {
	max-width: 6rem;
}
</style>

<template>
	<section id="drivers" class="pt-3">
		<!-- Smart Drivers -->
		<card v-if="smartDrivers.length > 0" title="Smart Drivers" :preview-templates="['config/drivers/smart']"
			  board-txt
			  url-title="Tuning Stepper Motor Drivers"
			  url="https://docs.duet3d.com/en/User_manual/Connecting_hardware/Motors_tuning">
			<template #append>
				<table class="table table-striped table-smart-drivers mb-0">
					<thead>
						<tr>
							<th class="text-center text-nowrap">
								Driver
							</th>
							<th v-if="showDriverTypeColumn">
								Driver Type
							</th>
							<th>
								Direction
							</th>
							<th>
								Motor Current
							</th>
							<th>
								Mode
							</th>
							<th>
								StealthChop PWM Threshold
							</th>
							<th>
								StallGuard Threshold
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="driver in smartDrivers">
							<td class="text-center align-middle">
								{{ driver.id }}
							</td>
							<td v-if="showDriverTypeColumn">
								<template v-if="!driver.id.board">
									<select-input title="Driver type installed in this slot (written to board.txt)"
												  :options="driverTypeOptions"
												  :model-value="getDriverType(driver.id.driver)"
												  @update:model-value="setDriverType(driver.id.driver, $event)"
												  :required="false" />
									<number-input v-if="getDriverType(driver.id.driver) === 'external5160' || getDriverType(driver.id.driver) === 'stepstick5160'"
												  class="mt-1"
												  title="Sense resistor value (Ω) of this TMC5160 module"
												  label="Rsense (Ω)"
												  :model-value="getDriverRsense(driver.id.driver)"
												  @update:model-value="setDriverRsense(driver.id.driver, $event)"
												  :min="0.001" :max="1.0" :step="0.001"
												  :preset="0.075" />
								</template>
							</td>
							<td>
								<select-input title="Movement direction of this driver" :required="false"
											  v-model="driver.forwards" :options="directionOptions" :preset="true" />
							</td>
							<td>
								<number-input title="Peak current for mapped drivers (not RMS). If this setting is not available, map this driver to an axis or extruder first"
											  :disabled="!hasMotorsMapped(driver)" :min="0" :max="getMaxCurrent(driver)"
											  :step="100" unit="mA" :model-value="getCurrent(driver)"
											  @update:model-value="setCurrent(driver, $event)"
											  :preset="getPresetCurrent(driver)" />
							</td>
							<td>
								<select-input :title="isSensorlessAxisDriver(driver) ? 'Mode is fixed by sensorless homing: StealthChop for TMC2209/2226, SpreadCycle for TMC2240/5160' : 'Operation mode of this driver. Defaults to SpreadCycle, depending on the board it may be changed to StealthChop to reduce motor noise'"
											  :disabled="isSensorlessAxisDriver(driver)"
											  :required="false" v-model="driver.mode" :options="getDriverModes(driver)"
											  :preset="ConfigDriverMode.spreadCycle" />
							</td>
							<td>
								<stealth-chop-calculator :driver="driver" />
							</td>
							<td>
								<number-input title="StallGuard threshold value. Only used for sensorless homing"
											  :min="-64" :max="63" :step="1" v-model="driver.sgThreshold" :preset="0" />
							</td>
						</tr>
					</tbody>
				</table>

				<div v-if="smartDrivers.some(driver => !hasMotorsMapped(driver))" class="alert alert-info mb-0">
					<i class="bi-info"></i>
					If you cannot set up required drivers, map them to axes or extruders first.
				</div>

				<div v-if="sensorlessEndstopWarning" class="alert alert-warning mb-0 mt-2">
					<i class="bi-exclamation-triangle"></i>
					Sensorless homing is enabled on {{ sensorlessEndstopWarning }} (StallGuard threshold set).
					On TMC2209/2226 drivers the DIAG pin shares the endstop connector, so the matching
					endstop input <strong>cannot be used</strong> for a physical switch and must be left
					unplugged on those drivers. Remember to set the endstop type to "sensorless" (M574 S3)
					for the affected axes.
				</div>
			</template>
		</card>

		<!-- Motor Current Reduction -->
		<card v-if="smartDrivers.length > 0" class="mt-3" title="Motor Current Reduction"
			  :preview-templates="['config/drivers/currentReduction']">
			<div class="row">
				<div class="col d-flex align-items-center">
					<check-input label="Reduce motor currents when idle" title="Reduce motor current on inactivity"
								 :model-value="store.data.move.idle.timeout > 0"
								 @update:model-value="store.data.move.idle.timeout = $event ? 30 : 0"
								 :preset="store.preset.move.idle.timeout > 0" />
				</div>
				<div class="col">
					<number-input label="Idle current percentage"
								  title="Motor current will be reduced to this percentage on inactivity"
								  :disabled="store.data.move.idle.timeout <= 0" v-model="store.data.move.idle.factor"
								  :preset="store.preset.move.idle.factor" :factor="100" unit="%" :min="0" :max="100"
								  :step="1" />
				</div>
				<div class="col">
					<number-input label="Idle timeout"
								  title="Maximum time for the machine to idle before current reduction is applied"
								  :disabled="store.data.move.idle.timeout <= 0" v-model="store.data.move.idle.timeout"
								  :preset="store.preset.move.idle.timeout" unit="s" />
				</div>
			</div>
		</card>

		<!-- External Drivers -->
		<card v-if="externalDrivers.length > 0" class="mt-3" title="External Drivers"
			  :preview-templates="['config/drivers/external']" url-title="Connecting External Drivers"
			  url="https://docs.duet3d.com/en/User_manual/Connecting_hardware/Motors_connecting_external">
			<template #append>
				<table class="table table-striped table-external-drivers mb-0">
					<thead>
						<tr>
							<th class="text-center">
								Driver
							</th>
							<th>
								Direction
							</th>
							<th>
								Enable Polarity
							</th>
							<th>
								Min. Step Pulse
							</th>
							<th>
								Min. Step Interval
							</th>
							<th>
								Dir. Setup Time
							</th>
							<th>
								Dir. Hold Time
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="driver in externalDrivers">
							<td class="text-center align-middle">
								{{ driver.id }}
							</td>
							<td>
								<select-input title="Movement direction of this driver" :required="false"
											  v-model="driver.forwards" :options="directionOptions" :preset="true" />
							</td>
							<td>
								<select-input title="Driver enable polarity of this driver" :required="false"
											  v-model="driver.external.enablePolarity" :options="polarityOptions"
											  :preset="false" />
							</td>
							<td>
								<number-input title="Minimum time for each step pulse" :min="0.1" :step="0.1" unit="µs"
											  v-model="driver.external.minStepPulse" :preset="5" />
							</td>
							<td>
								<number-input title="Minimum step interval" :min="0.1" :step="0.1" unit="µs"
											  v-model="driver.external.minStepInterval" :preset="5" />
							</td>
							<td>
								<number-input title="Time needed to set up the direction pin level" :min="0" :step="0.1"
											  unit="µs" v-model="driver.external.dirSetupTime" :preset="10" />
							</td>
							<td>
								<number-input title="Time to hold the direction pin level" :min="0" :step="0.1"
											  unit="µs" v-model="driver.external.holdTime" :preset="0" />
							</td>
						</tr>
					</tbody>
				</table>
			</template>
		</card>

		<!-- Closed Loop Drivers -->
		<card v-if="closedLoopDrivers.length > 0" class="mt-3" title="Closed Loop Drivers"
			  :preview-templates="['config/drivers/closedLoop']" url-title="Tuning Closed-Loop Motor Drivers"
			  url="https://docs.duet3d.com/en/User_manual/Tuning/Duet_3_1HCL_tuning">
			<template #append>
				<table class="table table-striped table-closed-loop-drivers mb-0">
					<thead>
						<tr>
							<th class="text-center">
								Driver
							</th>
							<th>
								Encoder Type
							</th>
							<th>
								Encoder Pulses per Revolution
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="driver in closedLoopDrivers">
							<td class="text-center align-middle">
								{{ driver.id }}
							</td>
							<td>
								<select-input title="Encoder type used for closed-loop operation" :required="false"
											  :disabled="hasBoardFixedClosedLoopSettings(driver.id.board) "
											  v-model="driver.closedLoop.encoderType" :options="encoderTypeOptions"
											  :preset="ConfigDriverClosedLoopEncoderType.none" />
							</td>
							<td>
								<number-input v-if="driver.closedLoop.pulsesPerRevolution !== null"
											  title="Encoder pulses per revolution" :min="1" :step="1"
											  :disabled="driver.closedLoop.encoderType === ConfigDriverClosedLoopEncoderType.none || driver.closedLoop.encoderType === ConfigDriverClosedLoopEncoderType.magnetic"
											  v-model="driver.closedLoop.pulsesPerRevolution" :preset="1000" />
							</td>
						</tr>
					</tbody>
				</table>
			</template>
		</card>
	</section>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue";

import Card from "@/components/Card.vue";
import StealthChopCalculator from "@/components/calculators/StealthChopCalculator.vue";
import SelectInput, { type SelectOption } from "@/components/inputs/SelectInput.vue";
import CheckInput from "@/components/inputs/CheckInput.vue";
import NumberInput from "@/components/inputs/NumberInput.vue";

import { useStore } from "@/store";
import { ConfigDriver, ConfigDriverClosedLoopEncoderType, ConfigDriverMode, requiredStallChopMode } from "@/store/model/ConfigDriver";
import { EndstopType } from "@duet3d/objectmodel";
import { ExpansionBoards, getExpansionBoardDefinition, type ExpansionBoardDescriptor } from "@/store/ExpansionBoards";
import { isSTM32BoardType, type STM32BoardDescriptor } from "@/store/STM32Boards";

const store = useStore();

// General
const directionOptions: Array<SelectOption> = [
	{
		text: "Forwards",
		value: true
	},
	{
		text: "Backwards",
		value: false
	}
];

// Smart Drivers
const smartDrivers = computed(() => {
	const result = [];
	for (const driver of store.data.configTool.drivers) {
		if (!driver.id.board && store.data.boardDefinition) {
			if ((driver.id.driver < store.data.boardDefinition.numDrivers && store.data.boardDefinition.hasSmartDrivers) ||
				(driver.id.driver >= store.data.boardDefinition.numDrivers && store.data.configTool.expansionBoard !== null && ExpansionBoards[store.data.configTool.expansionBoard].hasSmartDrivers)) {
				result.push(driver);
			}
		} else {
			const board = store.data.boards.find(board => board.canAddress === driver.id.board);
			if (board) {
				const boardDefinition = getExpansionBoardDefinition(board);
				if (boardDefinition?.hasSmartDrivers) {
					result.push(driver);
				}
			}
		}
	}
	return result;
});

function getDriverModes(driver: ConfigDriver) {
	const options: Array<SelectOption> = [
		{
			text: "SpreadCycle",
			value: ConfigDriverMode.spreadCycle
		}
	];

	const boardDefinition = store.data.getBoardDefinition(driver.id.board);
	if (boardDefinition?.hasStealthChop) {
		options.push({
			text: "StealthChop",
			value: ConfigDriverMode.stealthChop
		});
	}
	if (boardDefinition?.hasClosedLoopDrivers) {
		options.push({
			text: "Closed Loop",
			value: ConfigDriverMode.closedLoop
		});
	}

	return options;
}

function hasMotorsMapped(driver: ConfigDriver) {
	for (const axis of store.data.move.axes) {
		if (axis.drivers.some(item => item.equals(driver.id))) {
			return true;
		}
	}

	for (const extruder of store.data.move.extruders) {
		if (extruder.driver?.equals(driver.id)) {
			return true;
		}
	}

	return false;
}

function getMaxCurrent(driver: ConfigDriver) {
	const boardDef = store.data.getBoardDefinition(driver.id.board);
	if (!boardDef) return undefined;
	const perDriverMax = boardDef.motorMaxCurrentPerDriver?.[driver.id.driver];
	const boardMax = perDriverMax ?? boardDef.motorMaxCurrent;
	// For mainboard plug-in driver slots, apply driver-type-specific caps
	if (driver.id.board === null && !("builtInDrivers" in boardDef && boardDef.builtInDrivers)) {
		const driverType = getDriverType(driver.id.driver);
		if (driverType === "stepstick5160") return Math.min(boardMax, 3000);
		if (driverType === "external5160") return Math.max(boardMax, 8000);
	}
	return boardMax;
}

// ── STM32 driver type selection ──────────────────────────────────────────────

const driverTypeOptions: Array<SelectOption> = [
	{ text: "Auto detect (tmcauto)", value: "" },
	{ text: "TMC2208", value: "tmc2208" },
	{ text: "TMC2209", value: "tmc2209" },
	{ text: "TMC2225", value: "tmc2225" },
	{ text: "TMC2226", value: "tmc2226" },
	{ text: "TMC2240", value: "tmc2240" },
	{ text: "TMC5160", value: "tmc5160" },
	{ text: "TMC5160 Stepstick (plug-in, 3A)", value: "stepstick5160" },
	{ text: "External TMC5160 (SPI, up to 8A)", value: "external5160" },
];

const stm32Def = computed(() => {
	const bt = store.data.boardType;
	if (bt !== null && isSTM32BoardType(bt)) {
		return store.data.boardDefinition as STM32BoardDescriptor | null;
	}
	return null;
});

const showDriverTypeColumn = computed(() =>
	stm32Def.value !== null && !stm32Def.value.builtInDrivers
);

// Warn about the DIAG-pin / endstop conflict when sensorless homing (StallGuard threshold set)
// is enabled on a mainboard driver of an STM32 board that wires sensorless via diag pins.
// Only TMC2209/2226 support StallGuard (via the DIAG pin). TMC2208/2225 have no StallGuard;
// TMC2240/5160 use SPI — none of those use the diag pin, so they don't trigger the warning.
// Auto-detect ("") is assumed StallGuard-capable on these boards (TMC2209-class default).
const sensorlessEndstopWarning = computed(() => {
	const def = stm32Def.value;
	if (!def || !def.diagPins || def.diagPins.length === 0) {
		return null;
	}
	const stallCapable = (t: string) => t === "" || t === "tmcauto" || t === "tmc2209" || t === "tmc2226";
	const drivers = store.data.configTool.drivers
		.filter(d => !d.id.board && d.sgThreshold !== 0 && stallCapable(getDriverType(d.id.driver)))
		.map(d => `driver ${d.id.driver}`);
	if (drivers.length === 0) {
		return null;
	}
	return drivers.length === 1 ? drivers[0] : `${drivers.slice(0, -1).join(", ")} and ${drivers[drivers.length - 1]}`;
});

function getDriverType(driverIndex: number): string {
	const raw = store.data.configTool.stm32DriverTypes;
	if (!raw) return "";
	return raw.split(",")[driverIndex] ?? "";
}

function setDriverType(driverIndex: number, value: string) {
	const parts = store.data.configTool.stm32DriverTypes.split(",");
	parts[driverIndex] = value;
	store.data.configTool.stm32DriverTypes = parts.join(",");
	if (value !== "external5160" && value !== "stepstick5160") {
		const rParts = store.data.configTool.stm32DriverRsense.split(",");
		rParts[driverIndex] = "";
		store.data.configTool.stm32DriverRsense = rParts.join(",");
	} else if (value === "stepstick5160") {
		// Stepsticks use a standard 0.075 Ω sense resistor — pre-fill if not already set
		const rParts = store.data.configTool.stm32DriverRsense.split(",");
		if (!rParts[driverIndex]) {
			rParts[driverIndex] = "0.075";
			store.data.configTool.stm32DriverRsense = rParts.join(",");
		}
	}
	// Changing the driver type may change the chopper mode required for sensorless homing.
	const driver = store.data.configTool.drivers.find(d => !d.id.board && d.id.driver === driverIndex);
	if (driver && isSensorlessAxisDriver(driver)) {
		driver.mode = requiredStallChopMode(value);
	}
}

/**
 * True if this mainboard driver belongs to an axis configured with motor load detection
 * (sensorless homing), which forces a specific chopper mode.
 */
function isSensorlessAxisDriver(driver: ConfigDriver): boolean {
	if (driver.id.board) {
		return false;
	}
	const axisIndex = store.data.move.axes.findIndex(axis => axis.drivers.some(d => d.equals(driver.id)));
	if (axisIndex < 0 || axisIndex >= store.data.sensors.endstops.length) {
		return false;
	}
	const endstop = store.data.sensors.endstops[axisIndex];
	return !!endstop && (endstop.type === EndstopType.motorStallAny || endstop.type === EndstopType.motorStallIndividual);
}

// Keep the chopper mode in sync with the sensorless-homing requirement: StealthChop for
// TMC2209/2226 (StallGuard4), SpreadCycle for TMC2240/5160 (StallGuard2). Covers axis/driver
// remapping and configs loaded with motor load detection already enabled.
watchEffect(() => {
	if (!isSTM32BoardType(store.data.boardType as string)) {
		return;
	}
	for (const driver of store.data.configTool.drivers) {
		if (isSensorlessAxisDriver(driver)) {
			const mode = requiredStallChopMode(getDriverType(driver.id.driver));
			if (driver.mode !== mode) {
				driver.mode = mode;
			}
		}
	}
});

function getDriverRsense(driverIndex: number): number {
	const raw = store.data.configTool.stm32DriverRsense;
	if (!raw) return 0.075;
	const val = raw.split(",")[driverIndex];
	return val ? parseFloat(val) : 0.075;
}

function setDriverRsense(driverIndex: number, value: number) {
	const parts = store.data.configTool.stm32DriverRsense.split(",");
	parts[driverIndex] = value.toString();
	store.data.configTool.stm32DriverRsense = parts.join(",");
}

function getCurrent(driver: ConfigDriver) {
	for (const axis of store.data.move.axes) {
		if (axis.drivers.some(item => item.equals(driver.id))) {
			return axis.current;
		}
	}

	for (const extruder of store.data.move.extruders) {
		if (extruder.driver?.equals(driver.id)) {
			return extruder.current;
		}
	}

	return null;
}

function setCurrent(driver: ConfigDriver, value: number) {
	for (const axis of store.data.move.axes) {
		if (axis.drivers.some(item => item.equals(driver.id))) {
			axis.current = value;
			return;
		}
	}

	for (const extruder of store.data.move.extruders) {
		if (extruder.driver?.equals(driver.id)) {
			extruder.current = value;
			return;
		}
	}
}

function getPresetCurrent(driver: ConfigDriver) {
	for (const axis of store.preset.move.axes) {
		if (axis.drivers.some(item => item.equals(driver.id))) {
			return axis.current;
		}
	}

	for (const extruder of store.preset.move.extruders) {
		if (extruder.driver?.equals(driver.id)) {
			return extruder.current;
		}
	}

	return undefined;
}

// External Drivers
const externalDrivers = computed(() => {
	const result = [];
	for (const driver of store.data.configTool.drivers) {
		if (!driver.id.board && store.data.boardDefinition) {
			if ((driver.id.driver < store.data.boardDefinition.numDrivers && !store.data.boardDefinition.hasSmartDrivers) ||
				(driver.id.driver >= store.data.boardDefinition.numDrivers && store.data.configTool.expansionBoard !== null && !ExpansionBoards[store.data.configTool.expansionBoard].hasSmartDrivers)) {
				result.push(driver);
			}
		} else {
			const board = store.data.boards.find(board => board.canAddress === driver.id.board);
			if (board) {
				const boardDefinition = getExpansionBoardDefinition(board);
				if (boardDefinition && !boardDefinition.hasSmartDrivers) {
					result.push(driver);
				}
			}
		}
	}
	return result;
});

const polarityOptions: Array<SelectOption> = [
	{
		text: "Active Low",
		value: false
	},
	{
		text: "Active High",
		value: true
	}
];

// Closed Loop Drivers
const closedLoopDrivers = computed(() => {
	const result = [];
	for (const driver of store.data.configTool.drivers) {
		const boardDefinition = store.data.getBoardDefinition(driver.id.board);
		if (boardDefinition?.hasClosedLoopDrivers) {
			result.push(driver);
		}
	}
	return result;
});

const encoderTypeOptions: Array<SelectOption> = [
	{
		text: "None",
		value: ConfigDriverClosedLoopEncoderType.none
	},
	{
		text: "Quadrature encoder on linear axis",
		value: ConfigDriverClosedLoopEncoderType.quadratureOnAxis
	},
	{
		text: "Quadrature encoder on motor shaft",
		value: ConfigDriverClosedLoopEncoderType.quadratureOnMotor
	},
	{
		text: "Magnetic encoder on motor shaft",
		value: ConfigDriverClosedLoopEncoderType.magnetic
	}
];

function hasBoardFixedClosedLoopSettings(board: number | null) {
	if (!board) {
		return false;
	}

	const boardDefinition = store.data.getBoardDefinition(board) as ExpansionBoardDescriptor | null;
	return boardDefinition?.closedLoopConfig !== null;
}
</script>
