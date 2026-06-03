import {
	AnalogSensor,
	AnalogSensorType,
	Axis,
	AxisLetter,
	Board,
	CoreKinematics,
	DriverId,
	Endstop,
	EndstopType,
	Extruder,
	Fan,
	FanThermostaticControl,
	Heat,
	Heater,
	HeaterModel,
	HeaterModelPID,
	HeaterMonitor,
	HeaterMonitorAction,
	HeaterMonitorCondition,
	initCollection,
	initObject,
	KinematicsName,
	Limits,
	Microstepping,
	ModelSet,
	Move,
	Network,
	NetworkInterface,
	NetworkInterfaceState,
	NetworkInterfaceType,
	NetworkProtocol,
	Probe,
	ProbeType,
	Sensors,
	Tool
} from "@duet3d/objectmodel";
import { defineStore } from "pinia";

import ConfigModel from "@/store/model";
import { ConfigPortFunction } from "@/store/model/ConfigPort";
import { Boards, BoardType } from "@/store/Boards";
import { STM32BoardType } from "@/store/STM32Boards";

const defaultTemplate = initObject(ConfigModel, {
	boards: initCollection(Board, [
		Boards[BoardType.Duet3Mini5PlusWiFi].objectModelBoard
	]),
	fans: initCollection(Fan, [
		{
			// default
		},
		{
			thermostatic: initObject(FanThermostaticControl, {
				lowTemperature: 45,
				highTemperature: 45,
				sensors: [1]
			})
		}
	]),
	heat: initObject(Heat, {
		bedHeaters: [0],
		heaters: initCollection(Heater, [
			{
				max: 140,
				model: initObject(HeaterModel, {
					pid: initObject(HeaterModelPID, {
						used: false
					})
				}),
				monitors: initCollection(HeaterMonitor, [
					{
						action: HeaterMonitorAction.generateFault,
						condition: HeaterMonitorCondition.tooHigh,
						limit: 140,
						sensor: 0
					}
				]),
				sensor: 0
			},
			{
				max: 285,
				monitors: initCollection(HeaterMonitor, [
					{
						action: HeaterMonitorAction.generateFault,
						condition: HeaterMonitorCondition.tooHigh,
						limit: 285,
						sensor: 1
					}
				]),
				sensor: 1
			}
		])
	}),
	move: initObject(Move, {
		axes: initCollection(Axis, [
			{
				acceleration: 500,
				current: 800,
				drivers: initCollection(DriverId, [
					{
						board: 0,
						driver: 0
					}
				]),
				letter: AxisLetter.X,
				microstepping: initObject(Microstepping, {
					interpolated: true,
					value: 16
				}),
				jerk: 15,
				speed: 100,
				stepsPerMm: 80
			},
			{
				acceleration: 500,
				current: 800,
				drivers: initCollection(DriverId, [
					{
						board: 0,
						driver: 1
					}
				]),
				letter: AxisLetter.Y,
				microstepping: initObject(Microstepping, {
					interpolated: true,
					value: 16
				}),
				jerk: 15,
				speed: 100,
				stepsPerMm: 80
			},
			{
				acceleration: 20,
				current: 800,
				drivers: initCollection(DriverId, [
					{
						board: 0,
						driver: 2
					}
				]),
				letter: AxisLetter.Z,
				microstepping: initObject(Microstepping, {
					interpolated: true,
					value: 16
				}),
				jerk: 0.2,
				speed: 3,
				stepsPerMm: 400
			}
		]),
		extruders: initCollection(Extruder, [
			{
				acceleration: 250,
				current: 1000,
				driver: initObject(DriverId, {
					board: 0,
					driver: 3
				}),
				jerk: 2,
				microstepping: initObject(Microstepping, {
					interpolated: true,
					value: 16
				}),
				speed: 60,
				stepsPerMm: 420
			}
		]),
		kinematics: new CoreKinematics(KinematicsName.cartesian)
	}),
	limits: initObject(Limits, Boards[BoardType.Duet3Mini5PlusWiFi].objectModelLimits),
	network: initObject(Network, {
		name: "Fly E3 Ultra",
		interfaces: initCollection(NetworkInterface, [
			{
				activeProtocols: new ModelSet<NetworkProtocol>([NetworkProtocol.HTTP]),
				actualIP: "192.168.1.123",
				subnet: "255.255.255.0",
				gateway: "192.168.1.254",
				dnsServer: "192.168.1.254",
				state: NetworkInterfaceState.active,
				type: NetworkInterfaceType.ethernet
			}
		])
	}),
	sensors: initObject(Sensors, {
		analog: initCollection(AnalogSensor, [
			{
				name: "Heated Bed",
				type: AnalogSensorType.thermistor
			},
			{
				name: "Nozzle",
				type: AnalogSensorType.thermistor
			}
		]),
		endstops: initCollection(Endstop, [
			{
				type: EndstopType.InputPin
			},
			{
				type: EndstopType.InputPin
			},
			{
				type: EndstopType.ZProbeAsEndstop
			}
		]),
		probes: initCollection(Probe, [
			{
				// Default to a switch-type Z probe. On the default (STM32) board this is the
				// unfiltered digital type, matching what the "Switch" preset produces there.
				type: ProbeType.unfilteredDigital
			}
		])
	}),
	tools: initCollection(Tool, [
		{
			extruders: [0],
			filamentExtruder: 0,
			heaters: [1],
			fans: [0]
		}
	])
});
defaultTemplate.validate();
defaultTemplate.configTool.delta.calculateProbePoints(0, 0);

// Default to the Fly E3 Ultra — this is the STM32-focused TeamGloomy build of the tool.
// Switching the board rebuilds the port list using the board's pin aliases (validate() ->
// refreshPorts()), so the starter IO is wired up afterwards using those names.
defaultTemplate.boardType = STM32BoardType.Fly_E3Ultra;
defaultTemplate.configTool.assignPort("xstop", ConfigPortFunction.endstop, 0);		// X endstop
defaultTemplate.configTool.assignPort("ystop", ConfigPortFunction.endstop, 1);		// Y endstop
defaultTemplate.configTool.assignPort("probe", ConfigPortFunction.probeIn, 0);		// Z probe in
defaultTemplate.configTool.assignPort("bedtemp", ConfigPortFunction.thermistor, 0);	// Bed temp
defaultTemplate.configTool.assignPort("e0temp", ConfigPortFunction.thermistor, 1);	// Hot end temp
defaultTemplate.configTool.assignPort("bed", ConfigPortFunction.heater, 0);			// Bed heater
defaultTemplate.configTool.assignPort("e0heat", ConfigPortFunction.heater, 1);		// Hot end heater
defaultTemplate.configTool.assignPort("fan0", ConfigPortFunction.fan, 0);			// Part-cooling fan
defaultTemplate.configTool.assignPort("fan1", ConfigPortFunction.fan, 1);			// Hot end (thermostatic) fan

export const useStore = defineStore("model", {
    state: () => {
		return {
			data: initObject(ConfigModel, defaultTemplate),
			dataModified: false,
			preset: initObject(ConfigModel, defaultTemplate),
			showSavePrompt: false,

			darkTheme: (localStorage.getItem("theme") ?? "auto" === "auto") ? window.matchMedia("(prefers-color-scheme: dark)").matches : (localStorage.getItem("theme") === "dark"),
			theme: "auto" as "dark" | "light" | "auto",
			// Default the STM32/RRF community boards on (this is the STM32-focused tool); honour an
			// explicit "false" the user has previously saved.
			showCommunityBoards: localStorage.getItem("showSTM32Boards") !== "false"
		};
    },
    actions: {
		setModel(newModel: ConfigModel) {
			// Update deprecated port functions
			for (const port of newModel.configTool.ports) {
				if (port.function === ConfigPortFunction.spindleForwards_deprecated) {
					port.function = ConfigPortFunction.spindleFirstPort;
				} else if (port.function === ConfigPortFunction.spindleBackwards_deprecated) {
					port.function = ConfigPortFunction.spindleSecondPort;
				}
			}

			// Load model
			this.data.update(newModel);
			this.data.validate();
			this.dataModified = this.showSavePrompt = false;
		},
		setShowCommunityBoards(value: boolean) {
			this.showCommunityBoards = value;
			try { localStorage.setItem("showSTM32Boards", String(value)); } catch { /* ignore */ }
		},
		setTheme(theme: "dark" | "light" | "auto") {
			// Apply new theme value
			switch (theme) {
				case "dark":
					this.darkTheme = true;
					break;
				case "light":
					this.darkTheme = false;
					break;
				case "auto":
					this.darkTheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
					break;
				default:
					const _exhaustiveCheck: never = theme;
					break;
			}

			// Try to save it
			this.theme = theme;
			try {
				localStorage.setItem("theme", theme);
			} catch (e) {
				console.warn("localStorage not supported", e);
			}
		}
	}
});
