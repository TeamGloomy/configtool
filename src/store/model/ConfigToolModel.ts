import { initObject, ModelCollection, ModelDictionary, ModelObject, ModelSet } from "@duet3d/objectmodel";

import { ConfigPort, ConfigPortFunction } from "@/store/model/ConfigPort";
import { ConfigTempSensor } from "@/store/model/ConfigTempSensor";
import { ConfigDriver } from "@/store/model/ConfigDriver";
import type { ExpansionBoardType } from "@/store/ExpansionBoards";
import { precise } from "@/utils";

export class ConfigAutoSaveModel extends ModelObject {
	enabled: boolean = false;
	codesToRun: string = "M913 X0 Y0 G91 M83 G1 Z3 E-5 F1000";
	resumeThreshold: number = 22;
	saveThreshold: number = 19.8;
}

export class ConfigCapabilities extends ModelObject {
	cnc: boolean = false;
	fff: boolean = true;
	laser: boolean = false;
}

export class ConfigDeltaProbePoint extends ModelObject {
	x: number = 0;
	y: number = 0;
	heightCorrection: number = 0;
}

/** A simple X/Y coordinate, used for M671 leadscrew positions and bed.g probe points. */
export class ConfigCoordinate extends ModelObject {
	x: number = 0;
	y: number = 0;
}

export class ConfigDeltaProperties extends ModelObject {
	peripheralPoints: number = 3;
	halfwayPoints: number = 3;
	factors: number = 6;
	slowHoming: boolean = false;
	lowDiveHeight: boolean = true;
	probeRadius: number = 85;			// This is just for calibration and independent from move.compensation.probeGrid.radius
	readonly probePoints: ModelCollection<ConfigDeltaProbePoint> = new ModelCollection(ConfigDeltaProbePoint);
	homeFirst: boolean = true;

	/**
	 * Recalculate the Delta probe points
	 * @param probeOffsetX X offset of the probe
	 * @param probeOffsetY Y offset of the probe
	 */
	calculateProbePoints(probeOffsetX: number, probeOffsetY: number) {
		// Recalculate and add all probe points
		// Thanks to dc42 for providing the calculation code (original source from escher3d.com)
		const prevPoints = this.probePoints.splice(0);
		for (let i = 0; i < this.peripheralPoints; i++) {
			let probeX = this.probeRadius * Math.sin((2 * Math.PI * i) / this.peripheralPoints);
			let probeY = this.probeRadius * Math.cos((2 * Math.PI * i) / this.peripheralPoints);
			const rad = Math.sqrt(Math.pow(probeX + probeOffsetX, 2) + Math.pow(probeY + probeOffsetY, 2)) + 0.1;
			if (rad > this.probeRadius) {
				const factor = this.probeRadius / rad;
				probeX *= factor;
				probeY *= factor;
			}
			this.probePoints.push(initObject(ConfigDeltaProbePoint, {
				x: probeX,
				y: probeY,
				heightCorrection: (prevPoints.length > i) ? prevPoints[i].heightCorrection : 0
			}));
		}

		for (let i = 0; i < this.halfwayPoints; i++) {
			let probeX = (this.probeRadius / 2) * Math.sin((2 * Math.PI * i) / this.halfwayPoints);
			let probeY = (this.probeRadius / 2) * Math.cos((2 * Math.PI * i) / this.halfwayPoints);
			const rad = Math.sqrt(Math.pow(probeX + probeOffsetX, 2) + Math.pow(probeY + probeOffsetY, 2)) + 0.1;
			if (rad > this.probeRadius / 2) {
				const factor = (this.probeRadius / 2) / rad;
				probeX *= factor;
				probeY *= factor;
			}
			this.probePoints.push(initObject(ConfigDeltaProbePoint, {
				x: probeX,
				y: probeY,
				heightCorrection: (prevPoints.length > this.peripheralPoints + i) ? prevPoints[this.peripheralPoints + i].heightCorrection : 0
			}));
		}

		this.probePoints.push(initObject(ConfigDeltaProbePoint, {
			x: 0,
			y: 0,
			heightCorrection: 0
		}));

		for (const point of this.probePoints) {
			point.x = precise(point.x, 2);
			point.y = precise(point.y, 2);
		}
	}
}

export class ConfigDisplayFiles extends ModelObject {
	menus: ModelDictionary<string> = new ModelDictionary<string>(true);
	images: ModelDictionary<string> = new ModelDictionary<string>(true);
}

export class ConfigLaserModel extends ModelObject {
	maxIntensity: number = 255;
	sParamSticky: boolean = false;
}

export class ConfigWiFi extends ModelObject {
	ssid: string = "";
	psk: string = "";
}

export class ConfigToolModel extends ModelObject {
	version: number = 1;

	readonly autoSave: ConfigAutoSaveModel = new ConfigAutoSaveModel();
	autoSelectFirstTool: boolean = true;
	readonly capabilities: ConfigCapabilities = new ConfigCapabilities();
	configOverride: boolean = false;
	customSettings: string = "";
	readonly delta: ConfigDeltaProperties = new ConfigDeltaProperties();
	deployRetractProbes: ModelSet<number> = new ModelSet();
	readonly displayFiles: ConfigDisplayFiles = new ConfigDisplayFiles();
	readonly drivers: ModelCollection<ConfigDriver> = new ModelCollection(ConfigDriver);
	expansionBoard: ExpansionBoardType | null = null;
	homeBeforeAutoCalibration: boolean = false;
	homingSpeedFast: number = 30;
	homingSpeedSlow: number = 6;
	readonly laser: ConfigLaserModel = new ConfigLaserModel();
	name: string | null = null;
	orthogonalDistance: number = 85;
	panelDueChecksum: boolean = false;
	panelDueBaudRate: number = 57600;
	password: string = "";
	readonly ports: ModelCollection<ConfigPort> = new ModelCollection(ConfigPort);
	skewOffset: number = 100;
	readonly sensors: ModelCollection<ConfigTempSensor | null> = new ModelCollection(ConfigTempSensor);
	waitForToolTemperatures: boolean = true;
	readonly wifi: ConfigWiFi = new ConfigWiFi();
	/** Selected pins for serial.aux in board.txt, e.g. "A.10,A.9" (RX,TX). Empty = not configured. */
	stm32AuxSerial: string = "";
	/** Selected pins for serial.aux2 in board.txt, e.g. "D.9,D.8" (RX,TX). Empty = not configured. */
	stm32Aux2Serial: string = "";
	/** PanelDue channel for STM32 boards: 0 = serial.aux, 1 = serial.aux2, -1 = disabled. */
	stm32PanelDueChannel: number = -1;
	// ESP32 WiFi module pins — empty strings mean "use board default" (already in static board.txt content)
	stm32WifiEspDataReadyPin: string = "";
	stm32WifiTfrReadyPin:     string = "";
	stm32WifiEspResetPin:     string = "";
	stm32WifiSerialRxPin:     string = "";
	stm32WifiSerialTxPin:     string = "";
	/** WiFi module type; empty means use board default */
	stm32WifiModuleType:      string = "";

	// SPI channel pin overrides — "SCK,MISO,MOSI" or "" (no override from rrfboot default)
	stm32SpiCh0: string = "";
	stm32SpiCh1: string = "";
	stm32SpiCh2: string = "";
	stm32SpiCh3: string = "";
	stm32SpiCh4: string = "";
	stm32SpiCh5: string = "";
	stm32SpiCh6: string = "";
	stm32SpiCh7: string = "";
	stm32SpiCh8: string = "";

	/** SPI channel for heat.spiTempSensorChannel override (set via SPI Configuration role); -1 = use rrfboot default */
	stm32SpiTempChannel:   number = -1;

	// Per-driver type overrides for STM32 boards (comma-separated, "" per slot = tmcauto)
	stm32DriverTypes:  string = "";
	/** Comma-separated sense resistor values for External 5160 drivers (e.g. "0.075"), "" = none */
	stm32DriverRsense: string = "";

	// External accelerometer configuration (-1 = not configured)
	stm32AccelSpiChannel:  number = -1;
	stm32AccelCsPin:       string = "";
	stm32AccelIntPin:      string = "";
	stm32AccelOrientation: number = 20;

	/** Selected 12864 direct-display type for STM32 boards ("" = none). One of DISPLAY_TYPES keys. */
	stm32DisplayType: string = "";

	// Bed levelling using multiple independent Z motors (M671 in config.g + G32/bed.g).
	// Both collections hold one entry per Z motor; their order must match the Z drivers in M584.
	/** M671 leadscrew/pivot X/Y positions (one per Z motor). */
	readonly leadscrews: ModelCollection<ConfigCoordinate> = new ModelCollection(ConfigCoordinate);
	/** M671 S parameter — maximum correction allowed per leadscrew (mm). */
	leadscrewMaxCorrection: number = 1.0;
	/** bed.g G30 probe-point X/Y positions (one per Z motor). */
	readonly bedProbePoints: ModelCollection<ConfigCoordinate> = new ModelCollection(ConfigCoordinate);
	/** bed.g convergence: required deviation between probe points (mm) before the loop stops. */
	bedLevelingAccuracy: number = 0.02;
	/** bed.g convergence: maximum number of levelling passes before giving up. */
	bedLevelingMaxAttempts: number = 5;

	// Custom user content for tool change macros, keyed by tool number (as a string).
	/** Extra commands appended to tpre<n>.g (before tool selection). */
	readonly toolPreCommands: ModelDictionary<string> = new ModelDictionary<string>(true);
	/** Extra commands appended to tpost<n>.g (after tool selection). */
	readonly toolPostCommands: ModelDictionary<string> = new ModelDictionary<string>(true);
	/** Extra commands appended to tfree<n>.g (when tool is freed). */
	readonly toolFreeCommands: ModelDictionary<string> = new ModelDictionary<string>(true);

	assignPort(port: string, fn: ConfigPortFunction | null, index: number, frequency?: number): ConfigPort {
		for (const item of this.ports) {
			if (item.equals(port)) {
				item.function = fn;
				item.frequency = frequency ?? ((fn === ConfigPortFunction.fan || ConfigPortFunction.heater) ? 250 : 500);
				item.index = index;
				item.inverted = port.includes("!");
				item.pullUp = port.includes("^");
				return item;
			}
		}
		throw new Error(`Could not find port ${port}`);
	}

	getProbesByBoard(board: number | null): Set<number> {
		const probes = new Set<number>();
		for (const port of this.ports) {
			if (port.canBoard === board && [ConfigPortFunction.probeIn, ConfigPortFunction.probeMod, ConfigPortFunction.probeServo].includes(port.function!)) {
				probes.add(port.index);
			}
		}
		return probes;
	}
}
