import { DriverId, ModelObject } from "@duet3d/objectmodel";

export enum ConfigDriverClosedLoopEncoderType {
	none = 0,
	quadratureOnAxis = 1,
	quadratureOnMotor = 2,
	magnetic = 3
}

export class ConfigDriverClosedLoop extends ModelObject {
	encoderType: ConfigDriverClosedLoopEncoderType = ConfigDriverClosedLoopEncoderType.none;
	pulsesPerRevolution: number | null = 1000;
}

export class ConfigDriverExternal extends ModelObject {
	enablePolarity: boolean = false;
	minStepPulse: number = 5;
	minStepInterval: number = 5;
	dirSetupTime: number = 10;
	holdTime: number = 0;
}

export enum ConfigDriverMode {
	constantOffTime = 0,
	randomOffTime = 1,
	spreadCycle = 2,
	stealthChop = 3,
	closedLoop = 4
}

/**
 * Driver mode required for sensorless homing (motor load detection) given the configured
 * STM32 driver type. StallGuard4 drivers (TMC2209/2226, and auto-detect which assumes a
 * 2209-class driver) require StealthChop; StallGuard2 drivers (TMC2240/5160) require SpreadCycle.
 * @param driverType STM32 driver type string (e.g. "tmc2209", "tmc5160", "" for auto-detect)
 */
export function requiredStallChopMode(driverType: string): ConfigDriverMode {
	return (driverType === "tmc2240" || driverType === "tmc5160" || driverType === "external5160")
		? ConfigDriverMode.spreadCycle
		: ConfigDriverMode.stealthChop;
}

export class ConfigDriver extends ModelObject {
	readonly closedLoop: ConfigDriverClosedLoop = new ConfigDriverClosedLoop();
	readonly external: ConfigDriverExternal = new ConfigDriverExternal();
	forwards: boolean = true;
    homingSpeeds: Array<number> = [10, 5];
	id: DriverId = new DriverId();
	mode: ConfigDriverMode = ConfigDriverMode.spreadCycle;
	tpwmThreshold: number = 2000;
	sgThreshold: number = 0;
}
