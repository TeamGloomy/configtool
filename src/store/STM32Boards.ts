import { Board, initObject, Limits, MinMaxCurrent, NetworkInterface, NetworkInterfaceType } from "@duet3d/objectmodel";

import { PortType } from "@/store/BaseBoard";
import type { BoardDescriptor } from "@/store/Boards";
import { ExpansionBoardType } from "@/store/ExpansionBoards";

/**
 * A physical UART connector/header option available on an STM32 board.
 * rx/tx are STM32 pin names as used in board.txt (e.g. "D.9", "A.9").
 * Board.txt format: serial.aux.rxTxPins={rx, tx}  (RX first, then TX)
 */
export interface SerialPinOption {
    label: string;
    rx: string;
    tx: string;
    /**
     * If true, this option is not automatically selected when the board is first chosen.
     * Use for pins that are shared with another function (e.g. WiFi) and should only be
     * activated when the user explicitly decides to sacrifice that other function.
     */
    noAutoSelect?: boolean;
}

/**
 * Suggested external accelerometer wiring for a board, sourced from the TeamGloomy wiki.
 * Used to pre-populate the SPI configuration section.
 */
export interface AccelPreset {
    spiChannel: number;
    csPin: string;
    intPin: string;
    /** Only set when the suggested SPI pins differ from the rrfboot defaults for that channel */
    spiPins?: { sck: string; miso: string; mosi: string };
}

/**
 * Supported 12864 direct-display types. The pin aliases (encoder/CS/DC) and the config.g
 * command are constant across boards for a given display type — only the SPI channel varies,
 * so boards declare which types they support and on which channel (see `displays`).
 */
export type DisplayType = "reprapdiscount" | "ender3" | "fysetc12864";

export interface DisplayTypeDef {
    /** Human label for the UI dropdown */
    label: string;
    /** lcd.* board.txt keys (excluding spiChannel, which is board-specific) */
    encoderPinA: string;
    encoderPinB: string;
    encoderPinSw: string;
    lcdCSPin: string;
    lcdDCPin?: string;
    lcdBeepPin?: string;
    /** config.g line. For the RGB Fysetc panel this is replaced by M98 P"screen.g". */
    m918: string;
    /** When set, a screen.g macro is generated and config.g calls it via M98 instead of M918. */
    screenG?: string;
}

/** Constant per-type display definitions (pin aliases + config.g), shared across all boards. */
export const DISPLAY_TYPES: Record<DisplayType, DisplayTypeDef> = {
    reprapdiscount: {
        label: "RepRapDiscount Full Graphic Smart Controller",
        encoderPinA: "BTN_EN2", encoderPinB: "BTN_EN1", encoderPinSw: "BTN_ENC",
        lcdCSPin: "LCD_RS",
        m918: "M918 P1 E4 F100000",
    },
    ender3: {
        label: "Ender 3 stock display",
        encoderPinA: "LCD_D4", encoderPinB: "LCD_EN", encoderPinSw: "BTN_ENC",
        lcdCSPin: "LCD_D6", lcdBeepPin: "BEEP",
        m918: "M918 P1 E4 F1000000",
    },
    fysetc12864: {
        label: "Fysetc Mini12864 v2.1 (RGB)",
        encoderPinA: "BTN_EN1", encoderPinB: "BTN_EN2", encoderPinSw: "BTN_ENC",
        lcdCSPin: "LCD_EN", lcdDCPin: "LCD_RS",
        m918: "M918 P2 C30 F1000000 E4",
        // RGB panel needs a screen.g for the neopixel backlight + reset sequence; config.g calls it.
        screenG: `; ST7567 Init for Fysetc Mini12864 v2.1 Panel
; Configure Neopixel
M950 E0 C"LCD_D5"
; Turn off backlight
M150 K0 R0 U0 B0 S3 F0
; Configure reset pin
M950 P1 C"LCD_D4"
; hardware reset of LCD
M42 P1 S0
G4 P500
M42 P1 S1
; Turn display on
M918 P2 C30 F1000000 E4
; Fade in backlight
while iterations < 256
    M150 K0 R255 U255 B255 P{iterations} S1 F0
    G4 P20
; flash button 3 times
while iterations < 3
    M150 K0 R255 U255 B255 P255 S1 F1
    M150 K0 R0 U255 B0 P255 S2 F0
    G4 P250
    M150 K0 R255 U255 B255 P255 S1 F1
    M150 K0 R0 U255 B0 P0 S2 F0
    G4 P250
; Display "ready" button state
M150 K0 R255 U255 B255 P255 S1 F1
M150 K0 R255 U0 B0 P255 S2 F0`,
    },
};

/**
 * Parsed state of a single SPI channel derived from boardTxtContent.
 */
export interface ParsedSpiChannel {
    /** [SCK, MISO, MOSI] from rrfboot, or null when NoPin,NoPin,NoPin */
    pins: [string, string, string] | null;
    /** Human-readable reason this channel is locked, or null if free */
    lockedFor: string | null;
}

/**
 * Parse the SPI channel configuration from a board's boardTxtContent.
 * Returns 9 entries (index = channel number 0–8).
 */
export function parseSTM32SpiChannels(boardTxtContent: string): ParsedSpiChannel[] {
    const channels: ParsedSpiChannel[] = Array.from({ length: 9 }, () => ({ pins: null, lockedFor: null }));

    const spiRe = /^SPI(\d)\.pins=\{([^}]+)\}/gm;
    for (const m of boardTxtContent.matchAll(spiRe)) {
        const ch = parseInt(m[1]);
        if (ch >= 0 && ch <= 8) {
            const parts = m[2].split(',').map(p => p.trim());
            if (parts.length === 3 && !parts.every(p => p === 'NoPin')) {
                channels[ch].pins = parts as [string, string, string];
            }
        }
    }

    const lockPatterns: [RegExp, string][] = [
        [/^stepper\.spiChannel=(\d+)/m,        "Stepper drivers"],
        [/^wifi\.spiChannel=(\d+)/m,            "WiFi module"],
        [/^sbc\.spiChannel=(\d+)/m,             "SBC interface"],
        [/^heat\.spiTempSensorChannel=(\d+)/m,  "Temperature sensors"],
    ];
    const lockReasons = new Map<number, string[]>();
    for (const [re, reason] of lockPatterns) {
        const m = boardTxtContent.match(re);
        if (m) {
            const ch = parseInt(m[1]);
            if (ch > 8) continue;   // ignore placeholder values like 255
            if (!lockReasons.has(ch)) lockReasons.set(ch, []);
            lockReasons.get(ch)!.push(reason);
        }
    }
    for (const [ch, reasons] of lockReasons) {
        channels[ch].lockedFor = reasons.join(' / ');
    }
    return channels;
}

/**
 * Read a single key's value from a board's rrfboot/board.txt default content.
 * Returns the value with braces and whitespace stripped (e.g. "D.9,D.8"), or null if absent.
 */
export function getBoardTxtDefault(boardTxtContent: string, key: string): string | null {
    const prefix = key + "=";
    for (const line of boardTxtContent.split("\n")) {
        const t = line.trim();
        if (t.startsWith(prefix)) {
            return t.substring(prefix.length).replace(/[{}\s]/g, "");
        }
    }
    return null;
}

/**
 * ESP32 WiFi module pin configuration for a board.
 * All pin names use STM32 notation (e.g. "D.9", "G.8").
 * These map directly to the wifi.* keys in board.txt.
 */
export interface WifiPinConfig {
    espDataReadyPin: string;
    tfrReadyPin:     string;
    espResetPin:     string;
    /** STM32-side UART RX pin (connected to ESP TX) */
    serialRxPin:     string;
    /** STM32-side UART TX pin (connected to ESP RX) */
    serialTxPin:     string;
    /** SPI channel number — only for boards that use SPI for WiFi data transfer */
    spiChannel?:     number;
    /** SPI CS pin — only when spiChannel is set */
    spiCsPin?:       string;
    /** Default WiFi module type written to board.txt */
    moduleType:      "esp32" | "esp32eth";
    /** True when the WiFi module is soldered/dedicated — pins are fixed and the UI pin adjustment section is hidden */
    dedicated?:      boolean;
}

/**
 * Extended descriptor for STM32 boards — adds board.txt content and serial options
 */
export interface STM32BoardDescriptor extends BoardDescriptor {
    boardTxtContent: string;
    manufacturer: string;
    /**
     * Pool of all physical UART connectors available on this board.
     * The user assigns options from this pool to serial.aux and/or serial.aux2.
     */
    serialOptions: SerialPinOption[];
    /** ESP32 WiFi module pin defaults; undefined for non-WiFi boards. */
    wifiConfig?: WifiPinConfig;
    /** Wiki-suggested external accelerometer wiring; undefined when no suggestion exists. */
    accelPreset?: AccelPreset;
    /** Extra SPI channel locks from wiki that are not parseable from rrfboot alone (e.g. UART-WiFi boards where WiFi hardware shares a SPI bus) */
    spiChannelLocks?: { [channel: number]: string };
    /** Hide from the board selection dropdown (board is not yet fully supported — data kept for future use) */
    hidden?: boolean;
    /** When true, driver types are fixed/soldered — hide the per-driver type selector in the UI */
    builtInDrivers?: boolean;
    /** Per-driver M569.9 setup for boards with non-standard sense resistors (e.g. Kraken built-in 5160s) */
    m569DriverSetup?: { rsense: number; scale: number; driverCount: number };
    /**
     * Per-driver TMC DIAG pin names (STM32 notation, ordered by driver 0,1,2...) used for
     * sensorless homing on TMC2209/2226 boards. Written to stepper.TmcDiagPins in board.txt
     * for drivers that have sensorless enabled. The diag pin shares the endstop connector, so
     * enabling sensorless on a driver makes that endstop input unusable.
     * Omit for boards that don't support sensorless via diag pins (e.g. TMC5160 boards like
     * Kraken/Scylla, which RRF handles without diag pins).
     */
    diagPins?: string[];
    /** Board-specific setup notes/warnings shown on the General page (from the TeamGloomy wiki). */
    notes?: string[];
    /**
     * Supported 12864 direct-display types mapped to the SPI channel each uses on this board.
     * The pin aliases + config.g are constant per type (see DISPLAY_TYPES); only the channel
     * varies by board. Omit/empty for boards with no 12864 support (serial-screen-only boards).
     */
    displays?: Partial<Record<DisplayType, number>>;
}

/**
 * STM32 H7-based boards supported by the config tool.
 * Only STM32H723 and STM32H743 MCUs are included.
 */
export enum STM32BoardType {
    // BTT
    BTT_Kraken_v1_0          = "BTT Kraken v1.0 H723",
    BTT_Kraken_v1_1          = "BTT Kraken v1.1 H723",
    BTT_OctopusPro_v1_1_H723 = "BTT Octopus Pro v1.1 H723",
    BTT_SKR3_H723            = "BTT SKR3 H723",
    BTT_SKR3_H743            = "BTT SKR3 H743",
    BTT_SKR3EZ_H723          = "BTT SKR3 EZ H723",
    BTT_SKR3EZ_H743          = "BTT SKR3 EZ H743",
    BTT_SKR_SE_BX2           = "BTT SKR SE BX2 H743",
    BTT_Scylla               = "BTT Scylla v1.0 H723",
    // Fly
    Fly_C5                   = "Fly C5 H723",
    Fly_C8Pro                = "Fly C8 Pro H723",
    Fly_E3Ultra              = "Fly E3 Ultra H723",
    Fly_Super5               = "Fly Super5 H723",
    Fly_Super8Pro_H723       = "Fly Super8 Pro H723",
    Fly_Super8Pro_H743       = "Fly Super8 Pro H743",
    Fly_ProX10_H723          = "Fly Pro X10 H723",
    // Fysetc
    Fysetc_SpiderKing_H723   = "Fysetc Spider King H723",
    Fysetc_SpiderV3          = "Fysetc Spider V3 H723",
    // LDO
    LDO_Leviathan_H723       = "LDO Leviathan v1.3 H723",
    LDO_Leviathan_H743       = "LDO Leviathan v1.3 H743",
}

export function isSTM32BoardType(v: string): v is STM32BoardType {
    return Object.values(STM32BoardType).includes(v as STM32BoardType);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

interface MakeBoardParams {
    shortName: string;
    longName: string;
    manufacturer: string;
    numDrivers: number;
    boardTxtContent: string;
    thermistors: string[];
    heaters: string[];
    fans: string[];
    fanTachos?: string[];
    endstops: string[];
    /** Generic input pins that aren't endstops (e.g. power-loss/detect inputs: pwrdet, inddet, hvin). Available as gpIn but not in the endstop dropdowns. */
    gpIn?: string[];
    servos?: string[];
    spiCs?: string[];
    uart?: string[];
    gpOut?: string[];
    hasWiFi?: boolean;
    hasSBC?: boolean;
    hasVin?: boolean;
    /** All available UART connectors/headers on this board. User assigns from this pool to serial.aux and/or serial.aux2. */
    serialOptions?: SerialPinOption[];
    /** Neopixel/LED strip output pin aliases from rrfpins.txt (e.g. ["neopixel", "neopixel1"]) */
    neopixelPins?: string[];
    /** ESP32 WiFi module pin defaults (omit for non-WiFi boards) */
    wifiConfig?: WifiPinConfig;
    /** Wiki-suggested accelerometer wiring (omit when no suggestion) */
    accelPreset?: AccelPreset;
    /** Extra SPI channel locks beyond what rrfboot parsing detects */
    spiChannelLocks?: { [channel: number]: string };
    /** Hide from board selection dropdown */
    hidden?: boolean;
    /** When true, driver types are fixed — hide the per-driver type selector in the UI */
    builtInDrivers?: boolean;
    /** Per-driver M569.9 setup for boards with non-standard sense resistors (e.g. Kraken built-in 5160s) */
    m569DriverSetup?: { rsense: number; scale: number; driverCount: number };
    /** Per-driver TMC DIAG pin names for sensorless homing (TMC2209/2226 boards) */
    diagPins?: string[];
    /** Board-specific setup notes/warnings shown on the General page */
    notes?: string[];
    /** Supported 12864 display types mapped to the SPI channel each uses on this board */
    displays?: Partial<Record<DisplayType, number>>;
    /** Override the default motorMaxCurrent (2000 mA) for this board */
    motorMaxCurrent?: number;
    /** Override the default motorWarnCurrent (1600 mA) for this board */
    motorWarnCurrent?: number;
    /** Per-driver max current (mA); falls back to motorMaxCurrent when absent */
    motorMaxCurrentPerDriver?: number[];
}

function makeLimits(numDrivers: number): Limits {
    return initObject(Limits, {
        axes: Math.min(9, numDrivers),
        axesPlusExtruders: Math.min(12, numDrivers),
        bedHeaters: 4,
        boards: 1,
        chamberHeaters: 4,
        drivers: numDrivers,
        driversPerAxis: 4,
        extruders: Math.max(1, numDrivers - 3),
        extrudersPerTool: 8,
        fans: 20,
        gpInPorts: 20,
        gpOutPorts: 20,
        heaters: 10,
        heatersPerTool: 8,
        ledStrips: 2,
        monitorsPerHeater: 3,
        portsPerHeater: 2,
        restorePoints: 6,
        sensors: 32,
        spindles: 4,
        tools: 50,
        trackedObjects: 20,
        triggers: 16,
        volumes: 2,
        workplaces: 9,
        zProbeProgramBytes: 8,
        zProbes: 4
    });
}

function makeBoard(p: MakeBoardParams): STM32BoardDescriptor {
    const allOutputs = [...p.heaters, ...p.fans, ...(p.servos ?? [])];
    // Endstops plus any generic input pins (power-loss/detect etc.) that aren't endstops.
    const allInputs  = [...p.endstops, ...(p.gpIn ?? [])];

    const netInterfaces: Array<NetworkInterface> = p.hasWiFi
        ? [initObject(NetworkInterface, { type: NetworkInterfaceType.wifi })]
        : [];

    return {
        hasADCAutoCalibration:  false,
        hasClosedLoopDrivers:   false,
        hasInputPullUps:        true,
        hasMcuTempSensor:       true,
        hasSmartDrivers:        true,
        hasStealthChop:         true,
        hasVrefMonitor:         p.hasVin ?? false,
        motorWarnCurrent:       p.motorWarnCurrent ?? 1600,
        motorMaxCurrent:        p.motorMaxCurrent ?? 2000,
        motorMaxCurrentPerDriver: p.motorMaxCurrentPerDriver,
        minVoltage:             12,
        maxVoltage:             24,
        numDrivers:             p.numDrivers,
        microstepInterpolations:[1, 2, 4, 8, 16, 32, 64, 128],
        supportsAccelerometer:  true,
        displayDotstarPort:     null,
        expansionBoards:        new Set<ExpansionBoardType>(),
        supportsBME280:         true,
        supportsADS131:         false,
        ports: {
            [PortType.analogIn]:      p.thermistors,
            [PortType.fan]:           p.fans,
            [PortType.fanTacho]:      p.fanTachos ?? [],
            [PortType.gpIn]:          allInputs,
            [PortType.gpInInterrupt]: allInputs,
            // gpOut is for truly generic outputs (LED strip, M42, etc.).
            // Heater and fan pins already have their own PortType capabilities and must NOT
            // appear here, or they pollute the LED strip / gpOut port dropdowns.
            [PortType.gpOut]:         [...(p.gpOut ?? []), ...(p.neopixelPins ?? [])],
            [PortType.heater]:        p.heaters,
            [PortType.pwm]:           allOutputs,
            [PortType.scanning]:      [],
            [PortType.spiCs]:         p.spiCs ?? [],
            [PortType.thermistor]:    p.thermistors,
            [PortType.uart]:          p.uart ?? [],
        },
        objectModelBoard: initObject(Board, {
            canAddress:            0,
            ...(p.hasSBC ? { iapFileNameSBC: "firmware.bin" } : {}),
            maxHeaters:            p.heaters.length,
            maxMotors:             p.numDrivers,
            name:                  p.longName,
            shortName:             p.shortName,
            supportsDirectDisplay: false,
            ...(p.hasVin ? { vIn: new MinMaxCurrent() } : {})
        }),
        objectModelLimits:            makeLimits(p.numDrivers),
        objectModelNetworkInterfaces: netInterfaces,
        boardTxtContent: p.boardTxtContent,
        manufacturer:    p.manufacturer,
        serialOptions:   p.serialOptions ?? [],
        wifiConfig:      p.wifiConfig,
        accelPreset:      p.accelPreset,
        spiChannelLocks:  p.spiChannelLocks,
        hidden:           p.hidden,
        builtInDrivers:   p.builtInDrivers,
        m569DriverSetup:  p.m569DriverSetup,
        diagPins:         p.diagPins,
        notes:            p.notes,
        displays:         p.displays,
    };
}

// ---------------------------------------------------------------------------
// Board definitions
// ---------------------------------------------------------------------------

export const STM32Boards: Record<STM32BoardType, STM32BoardDescriptor> = {

    // ── BTT ────────────────────────────────────────────────────────────────

    [STM32BoardType.BTT_Kraken_v1_0]: makeBoard({
        shortName: "kraken_h723", longName: "BTT Kraken V1.0 STM32H723", manufacturer: "BTT",
        notes: [
            "Requires RepRapFirmware 3.5.0-rc.2 or later.",
            "Built-in TMC5160 drivers: the M569.9 sense-resistor lines are generated automatically (V1.0 uses R0.022).",
            "Remove the DIAG-pin jumpers on the first four drivers — RRF does not use them for sensorless homing on TMC5160.",
            "Driver power is 24-60V via HV-IN; fan output voltage is jumper-selectable (5V / 12V / VCC).",
            "M1–M4 (drivers 0–3): up to 8A driving current; M5–M8 (drivers 4–7): up to 3A. Additional cooling recommended above 7A.",
        ],
        numDrivers: 8,
        hasWiFi: true, hasSBC: true, hasVin: false,
        builtInDrivers: true,
        m569DriverSetup: { rsense: 0.022, scale: 8, driverCount: 4 },
        motorMaxCurrentPerDriver: [8000, 8000, 8000, 8000, 3000, 3000, 3000, 3000],
        accelPreset: { spiChannel: 5, csPin: "D.14", intPin: "G.3" },
        thermistors: ["bedtemp", "e0temp", "e1temp", "e2temp", "e3temp", "adc1", "adc2"],
        heaters:     ["bed", "e0heat", "e1heat", "e2heat", "e3heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5", "fan6", "fan7"],
        fanTachos:   ["fan6.tacho", "fan7.tacho"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "e2stop", "e3stop", "e4stop", "probe"],
        gpIn:        ["inddet"],
        servos:      ["servo0", "servo1"],
        gpOut:       ["pson"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel", "neopixel1"],
        wifiConfig: {
            espDataReadyPin: "G.8", tfrReadyPin: "G.7", espResetPin: "G.6",
            serialRxPin: "B.11", serialTxPin: "B.10",
            spiChannel: 6, spiCsPin: "E.11",
            moduleType: "esp32",
        },
        serialOptions: [
            { label: "EXP Header (UART3 — D.9/D.8)", rx: "D.9", tx: "D.8" },
        ],
        boardTxtContent: `board=kraken_h723
board.longName="BTT Kraken V1 STM32H723"
sdcard.internal.type=5
SPI0.pins={NoPin,NoPin,NoPin}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={C.10,C.11,C.12}
SPI3.pins={C.6,C.7,C.8}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={D.13,D.15,D.12}
SPI6.pins={E.12,E.13,E.14}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={E.6,E.3,E.0,B.7,G.13,G.12,B.5,G.14}
stepper.stepPins={C.14,E.5,E.2,B.9,G.9,G.11,B.4,G.15}
stepper.directionPins={C.13,E.4,E.1,B.8,G.10,D.7,B.3,B.6}
stepper.numSmartDrivers=8
stepper.num5160Drivers=8
stepper.spiChannel=3
stepper.TmcUartPins={D.6,D.5,D.4,D.3,D.2,A.15,A.9,A.10}
power.VInDetectPin=NoPin
sbc.TfrReadyPin=G.6
sbc.csPin=E.11
sbc.spiChannel=6
wifi.espDataReadyPin=G.8
wifi.TfrReadyPin=G.7
wifi.espResetPin=G.6
wifi.spiChannel=6
wifi.csPin=E.11
wifi.serialRxTxPins={B.11,B.10}
wifi.moduleType=esp32
heat.tempSensePins={B.0,B.1,C.5,C.4,A.7}
can.writePin=D.1
can.readPin=D.0
serial.aux.rxTxPins={D.9,D.8}
heat.spiTempSensorChannel=2
heat.spiTempSensorCSPins={C.9,A.8}`,
    }),

    [STM32BoardType.BTT_Kraken_v1_1]: makeBoard({
        shortName: "kraken_h723", longName: "BTT Kraken V1.1 STM32H723", manufacturer: "BTT",
        notes: [
            "Requires RepRapFirmware 3.5.0-rc.2 or later.",
            "Built-in TMC5160 drivers: the M569.9 sense-resistor lines are generated automatically (V1.1 uses R0.05).",
            "Remove the DIAG-pin jumpers on the first four drivers — RRF does not use them for sensorless homing on TMC5160.",
            "Driver power is 24-60V via HV-IN; fan output voltage is jumper-selectable (5V / 12V / VCC).",
            "M1–M4 (drivers 0–3): up to 4.7A peak; M5–M8 (drivers 4–7): up to 3A.",
        ],
        numDrivers: 8,
        hasWiFi: true, hasSBC: true, hasVin: false,
        builtInDrivers: true,
        m569DriverSetup: { rsense: 0.05, scale: 4.7, driverCount: 4 },
        motorMaxCurrentPerDriver: [4700, 4700, 4700, 4700, 3000, 3000, 3000, 3000],
        accelPreset: { spiChannel: 5, csPin: "D.14", intPin: "G.3" },
        thermistors: ["bedtemp", "e0temp", "e1temp", "e2temp", "e3temp", "adc1", "adc2"],
        heaters:     ["bed", "e0heat", "e1heat", "e2heat", "e3heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5", "fan6", "fan7"],
        fanTachos:   ["fan6.tacho", "fan7.tacho"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "e2stop", "e3stop", "e4stop", "probe"],
        gpIn:        ["inddet"],
        servos:      ["servo0", "servo1"],
        gpOut:       ["pson"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel", "neopixel1"],
        wifiConfig: {
            espDataReadyPin: "G.8", tfrReadyPin: "G.7", espResetPin: "G.6",
            serialRxPin: "B.11", serialTxPin: "B.10",
            spiChannel: 6, spiCsPin: "E.11",
            moduleType: "esp32",
        },
        serialOptions: [
            { label: "EXP Header (UART3 — D.9/D.8)", rx: "D.9", tx: "D.8" },
        ],
        boardTxtContent: `board=kraken_h723
board.longName="BTT Kraken V1.1 STM32H723"
sdcard.internal.type=5
SPI0.pins={NoPin,NoPin,NoPin}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={C.10,C.11,C.12}
SPI3.pins={C.6,C.7,C.8}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={D.13,D.15,D.12}
SPI6.pins={E.12,E.13,E.14}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={E.6,E.3,E.0,B.7,G.13,G.12,B.5,G.14}
stepper.stepPins={C.14,E.5,E.2,B.9,G.9,G.11,B.4,G.15}
stepper.directionPins={C.13,E.4,E.1,B.8,G.10,D.7,B.3,B.6}
stepper.numSmartDrivers=8
stepper.num5160Drivers=8
stepper.spiChannel=3
stepper.TmcUartPins={D.6,D.5,D.4,D.3,D.2,A.15,A.9,A.10}
power.VInDetectPin=NoPin
sbc.TfrReadyPin=G.6
sbc.csPin=E.11
sbc.spiChannel=6
wifi.espDataReadyPin=G.8
wifi.TfrReadyPin=G.7
wifi.espResetPin=G.6
wifi.spiChannel=6
wifi.csPin=E.11
wifi.serialRxTxPins={B.11,B.10}
wifi.moduleType=esp32
heat.tempSensePins={B.0,B.1,C.5,C.4,A.7}
can.writePin=D.1
can.readPin=D.0
serial.aux.rxTxPins={D.9,D.8}
heat.spiTempSensorChannel=2
heat.spiTempSensorCSPins={C.9,A.8}`,
    }),

    [STM32BoardType.BTT_OctopusPro_v1_1_H723]: makeBoard({
        shortName: "octopuspro1_1_h723", longName: "BTT Octopus Pro V1.1 STM32H723", manufacturer: "BTT",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["G.6", "G.9", "G.10", "G.11", "G.12", "G.13", "G.14", "G.15"],
        notes: [
            "Requires RepRapFirmware 3.5.0-rc.2 or later.",
            "Firmware only supports the STM32H723ZG chip variant, NOT the H723ZE — check the chip marking.",
            "Set the per-driver jumpers correctly: UART mode for TMC22xx, SPI mode for TMC5160.",
            "Driver power is jumper-selectable: VIN (12/24V) or MOT-PWR (up to 60V). Fan voltage is jumper-selectable (5V / 12V / VCC).",
        ],
        numDrivers: 8,
        hasWiFi: true, hasSBC: true, hasVin: false,
        accelPreset: { spiChannel: 5, csPin: "E.12", intPin: "E.10", spiPins: { sck: "E.8", miso: "E.9", mosi: "E.7" } },
        thermistors: ["bedtemp", "e0temp", "e1temp", "e2temp", "e3temp"],
        heaters:     ["bed", "e0heat", "e1heat", "e2heat", "e3heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "e2stop", "e3stop", "e4stop", "probe", "probe1"],
        gpIn:        ["pwrdet"],
        servos:      ["servo0"],
        gpOut:       ["pson"],
        spiCs:       ["xcs", "ycs", "zcs", "e0cs", "e1cs", "e2cs", "e3cs", "e4cs"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "D.7", tfrReadyPin: "D.10", espResetPin: "G.7",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32",
        },
        serialOptions: [
            { label: "TFT Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=octopuspro1_1_h723
board.longName="BTT Octopus Pro V1.1 STM32H723"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,C.2,C.3}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={E.8,E.9,E.7}
SPI5.pins={E.12,NoPin,E.9}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={F.14,F.15,G.5,A.2,G.2,F.1,D.4,E.0}
stepper.stepPins={F.13,G.0,F.11,G.4,F.9,C.13,E.2,E.6}
stepper.directionPins={F.12,G.1,G.3,C.1,F.10,F.0,E.3,A.14}
stepper.numSmartDrivers=8
stepper.TmcUartPins={C.4,D.11,C.6,C.7,F.2,E.4,E.1,D.3}
stepper.spiChannel=0
power.VInDetectPin=NoPin
sbc.TfrReadyPin=D.10
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=D.7
wifi.TfrReadyPin=D.10
wifi.espResetPin=G.7
wifi.serialRxTxPins={D.9, D.8}
heat.tempSensePins={F.3,F.4,F.5,F.6,F.7}
heat.spiTempSensorChannel=0
heat.spiTempSensorCSPins={F.8}
can.writePin=D.1
can.readPin=D.0`,
    }),

    [STM32BoardType.BTT_SKR3_H723]: makeBoard({
        shortName: "skr3_h723", longName: "BTT SKR3 STM32H723", manufacturer: "BTT",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["C.1", "C.3", "C.0", "C.2", "A.0"],
        notes: [
            "The SKR3 H723 and H743 are physically different boards — check the MCU marking and pick the matching one.",
            "Driver jumpers: 'Normal' for standalone drivers, 'UART mode' (with interpolation) for TMC2208/2209/2225/2226.",
            "For PT1000 sensors fit the PT1000 jumper and use R1000 in M308; remove the jumper for standard thermistors.",
        ],
        numDrivers: 5,
        hasWiFi: true, hasSBC: true, hasVin: false,
        accelPreset: { spiChannel: 4, csPin: "E.10", intPin: "E.9" },
        thermistors: ["bedtemp", "e0temp", "e1temp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "probe"],
        gpIn:        ["pwrdet"],
        servos:      ["servo0"],
        gpOut:       ["pson"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "B.10", tfrReadyPin: "B.11", espResetPin: "C.14",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "TFT Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=skr3_h723
board.longName="BTT SKR3 STM32H723"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={E.14,E.15,E.13}
SPI4.pins={C.5,B.1,B.0}
SPI5.pins={E.9,NoPin,B.1}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={D.6,D.1,E.0,C.7,D.13}
stepper.stepPins={D.4,A.15,E.2,D.15,D.11}
stepper.directionPins={D.3,A.8,E.3,D.14,D.10}
stepper.numSmartDrivers=5
stepper.TmcUartPins={D.5,D.0,E.1,C.6,D.12}
stepper.spiChannel=3
power.VInDetectPin=NoPin
sbc.TfrReadyPin=C.14
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=B.10
wifi.TfrReadyPin=B.11
wifi.espResetPin=C.14
wifi.serialRxTxPins={D.9, D.8}
heat.tempSensePins={A.1,A.2,A.3}`,
    }),

    [STM32BoardType.BTT_SKR3_H743]: makeBoard({
        shortName: "skr3_h743", longName: "BTT SKR3 STM32H743", manufacturer: "BTT",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["C.1", "C.3", "C.0", "C.2", "A.0"],
        notes: [
            "The SKR3 H723 and H743 are physically different boards — check the MCU marking and pick the matching one.",
            "Driver jumpers: 'Normal' for standalone drivers, 'UART mode' (with interpolation) for TMC2208/2209/2225/2226.",
            "For PT1000 sensors fit the PT1000 jumper and use R1000 in M308; remove the jumper for standard thermistors.",
        ],
        numDrivers: 5,
        hasWiFi: true, hasSBC: true, hasVin: false,
        accelPreset: { spiChannel: 4, csPin: "E.10", intPin: "E.9" },
        thermistors: ["bedtemp", "e0temp", "e1temp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "probe"],
        gpIn:        ["pwrdet"],
        servos:      ["servo0"],
        gpOut:       ["pson"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "B.10", tfrReadyPin: "B.11", espResetPin: "C.14",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "TFT Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=skr3_h743
board.longName="BTT SKR3 STM32H743"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={E.14,E.15,E.13}
SPI4.pins={C.5,B.1,B.0}
SPI5.pins={E.9,NoPin,B.1}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={D.6,D.1,E.0,C.7,D.13}
stepper.stepPins={D.4,A.15,E.2,D.15,D.11}
stepper.directionPins={D.3,A.8,E.3,D.14,D.10}
stepper.numSmartDrivers=5
stepper.TmcUartPins={D.5,D.0,E.1,C.6,D.12}
stepper.spiChannel=3
power.VInDetectPin=NoPin
sbc.TfrReadyPin=C.14
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=B.10
wifi.TfrReadyPin=B.11
wifi.espResetPin=C.14
wifi.serialRxTxPins={D.9, D.8}
heat.tempSensePins={A.1,A.2,A.3}`,
    }),

    [STM32BoardType.BTT_SKR3EZ_H723]: makeBoard({
        shortName: "skr3ez_h723", longName: "BTT SKR3 EZ STM32H723", manufacturer: "BTT",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["C.1", "C.3", "C.0", "C.2", "A.0"],
        notes: [
            "The SKR3 EZ H723 and H743 are physically different boards — check the MCU marking and pick the matching one.",
            "You cannot mix SPI and UART drivers on this board (no mixing TMC5160 with TMC22xx).",
            "For PT1000 sensors fit the PT1000 jumper and use R2200 in M308 (note: differs from the non-EZ SKR3, which uses R1000); remove the jumper for standard thermistors.",
        ],
        numDrivers: 5,
        hasWiFi: true, hasSBC: true, hasVin: false,
        accelPreset: { spiChannel: 4, csPin: "E.10", intPin: "E.9" },
        thermistors: ["bedtemp", "e0temp", "e1temp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "probe"],
        gpIn:        ["pwrdet"],
        servos:      ["servo0"],
        gpOut:       ["pson"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "B.10", tfrReadyPin: "B.11", espResetPin: "C.14",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "TFT Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=skr3ez_h723
board.longName="BTT SKR3EZ STM32H723"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={E.14,E.15,E.13}
SPI4.pins={C.5,B.1,B.0}
SPI5.pins={E.9,NoPin,B.1}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={D.6,D.1,E.0,C.7,D.13}
stepper.stepPins={D.4,A.15,E.2,D.15,D.11}
stepper.directionPins={D.3,A.8,E.3,D.14,D.10}
stepper.numSmartDrivers=5
stepper.TmcUartPins={D.5,D.0,E.1,C.6,D.12}
stepper.spiChannel=3
power.VInDetectPin=NoPin
sbc.TfrReadyPin=C.14
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=B.10
wifi.TfrReadyPin=B.11
wifi.espResetPin=C.14
wifi.serialRxTxPins={D.9, D.8}
heat.tempSensePins={A.1,A.2,A.3}`,
    }),

    [STM32BoardType.BTT_SKR3EZ_H743]: makeBoard({
        shortName: "skr3ez_h743", longName: "BTT SKR3 EZ STM32H743", manufacturer: "BTT",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["C.1", "C.3", "C.0", "C.2", "A.0"],
        notes: [
            "The SKR3 EZ H723 and H743 are physically different boards — check the MCU marking and pick the matching one.",
            "You cannot mix SPI and UART drivers on this board (no mixing TMC5160 with TMC22xx).",
            "For PT1000 sensors fit the PT1000 jumper and use R2200 in M308 (note: differs from the non-EZ SKR3, which uses R1000); remove the jumper for standard thermistors.",
        ],
        numDrivers: 5,
        hasWiFi: true, hasSBC: true, hasVin: false,
        accelPreset: { spiChannel: 4, csPin: "E.10", intPin: "E.9" },
        thermistors: ["bedtemp", "e0temp", "e1temp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2"],
        endstops:    ["xstop", "ystop", "zstop", "e0stop", "e1stop", "probe"],
        gpIn:        ["pwrdet"],
        servos:      ["servo0"],
        gpOut:       ["pson"],
        uart:        ["tx1"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "B.10", tfrReadyPin: "B.11", espResetPin: "C.14",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "TFT Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=skr3ez_h743
board.longName="BTT SKR3EZ STM32H743"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={E.14,E.15,E.13}
SPI4.pins={C.5,B.1,B.0}
SPI5.pins={E.9,NoPin,B.1}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={D.6,D.1,E.0,C.7,D.13}
stepper.stepPins={D.4,A.15,E.2,D.15,D.11}
stepper.directionPins={D.3,A.8,E.3,D.14,D.10}
stepper.numSmartDrivers=5
stepper.TmcUartPins={D.5,D.0,E.1,C.6,D.12}
stepper.spiChannel=3
power.VInDetectPin=NoPin
sbc.TfrReadyPin=C.14
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=B.10
wifi.TfrReadyPin=B.11
wifi.espResetPin=C.14
wifi.serialRxTxPins={D.9, D.8}
heat.tempSensePins={A.1,A.2,A.3}`,
    }),

    [STM32BoardType.BTT_SKR_SE_BX2]: makeBoard({
        shortName: "skrsebx2_h743", longName: "BTT SKR SE BX2 STM32H743", manufacturer: "BTT",
        numDrivers: 5,
        hasWiFi: false, hasSBC: true, hasVin: false,
        thermistors: ["e0temp", "e1temp", "e2temp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2"],
        endstops:    ["xstop", "xstopmax", "ystop", "ystopmax", "zstop", "zstopmax", "probe"],
        servos:      ["servo0"],
        serialOptions: [
            { label: "TFT Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=skrsebx2_h743
board.longName="BTT SKR SE BX2 STM32H743"
sdcard.internal.type=4
SPI0.pins={NoPin,NoPin,NoPin}
SPI1.pins={NoPin,NoPin,NoPin}
SPI2.pins={C.10,C.11,C.12}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
SPI6.pins={E.2,E.5,E.6}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=I.11
stepper.enablePins={G.14,B.4,G.9,C.15,D.2}
stepper.stepPins={G.13,B.3,D.7,C.14,A.8}
stepper.directionPins={G.12,D.3,D.6,C.13,C.9}
stepper.numSmartDrivers=5
stepper.TmcUartPins={G.10,D.4,D.5,I.8,C.8}
power.VInDetectPin=NoPin
sbc.TfrReadyPin=H.12
sbc.csPin=H.10
sbc.spiChannel=6`,
    }),

    [STM32BoardType.BTT_Scylla]: makeBoard({
        shortName: "scylla1_0_h723", longName: "BTT Scylla V1.0 STM32H723", manufacturer: "BTT",
        builtInDrivers: true,
        m569DriverSetup: { rsense: 0.05, scale: 10, driverCount: 4 },
        motorMaxCurrent: 4700,
        motorWarnCurrent: 3500,
        notes: [
            "Requires RepRapFirmware 3.5.1 or later.",
            "Built-in TMC5160 drivers: the M569.9 sense-resistor lines are generated automatically (R0.05).",
            "24-60V input; the aux outputs run at the input voltage (there is no separate aux rail).",
            "Maximum driver current: 4.7A peak per driver.",
        ],
        numDrivers: 4,
        hasWiFi: true, hasSBC: true, hasVin: false,
        thermistors: [],
        heaters:     [],
        fans:        ["aux0", "aux1", "aux2", "mist", "coolant"],
        endstops:    ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax", "amin", "amax", "probe", "tool", "extin0"],
        gpOut:       ["aux0", "aux1", "aux2", "mist", "coolant", "spindleen", "spindlepwm", "spindledir", "relay"],
        uart:        ["tx1", "rs485a"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "E.9", tfrReadyPin: "E.8", espResetPin: "E.10",
            serialRxPin: "A.3", serialTxPin: "A.2",
            spiChannel: 6, spiCsPin: "E.11",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "RS485 / AUX1 Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
            { label: "EXP2 Header (UART3 — D.9/D.8)", rx: "D.9", tx: "D.8" },
        ],
        boardTxtContent: `board=scylla1_0_h723
board.longName="BTT Scylla V1.0 STM32H723"
sdcard.internal.type=2
SPI0.pins={NoPin,NoPin,NoPin}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={B.3,B.4,B.5}
SPI5.pins={NoPin,NoPin,NoPin}
SPI6.pins={E.12,E.13,E.14}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={C.0,C.2,E.5,E.1}
stepper.stepPins={A.0,C.13,B.8,D.3}
stepper.directionPins={A.1,E.6,B.9,D.4}
stepper.numSmartDrivers=4
stepper.DriverType={tmc5160, tmc5160, tmc5160, tmc5160}
stepper.TmcUartPins={C.15,C.14,E.2,E.4}
stepper.spiChannel=2
power.VInDetectPin=NoPin
wifi.espDataReadyPin=E.9
wifi.TfrReadyPin=E.8
wifi.espResetPin=E.10
wifi.spiChannel=6
wifi.csPin=E.11
wifi.serialRxTxPins={A.3, A.2}
wifi.moduleType=esp32
sbc.TfrReadyPin=D.10
sbc.csPin=B.12
sbc.spiChannel=1
sbc.sbcMode=0
can.writePin=D.1
can.readPin=D.0
serial.aux2.rxTxPins={D.9, D.8}`,
    }),

    // ── Fly ────────────────────────────────────────────────────────────────

    [STM32BoardType.Fly_C5]: makeBoard({
        shortName: "c5_1_0", longName: "Fly C5 H723", manufacturer: "Fly",
        numDrivers: 5,
        hasWiFi: false, hasSBC: true, hasVin: true,
        hidden: true,
        thermistors: ["bedtemp", "e0temp", "e1temp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "laser"],
        endstops:    ["xstop", "xstopmax", "ystop", "ystopmax", "zstop", "zstopmax", "probe"],
        servos:      ["servo"],
        neopixelPins: ["neopixel"],
        serialOptions: [],
        boardTxtContent: `board=c5_1_0
board.longName="Fly C5"
sdcard.internal.type=255
SPI0.pins={NoPin,NoPin,NoPin}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={D.3,D.7,E.2,E.6,C.0}
stepper.stepPins={D.1,D.6,E.1,E.5,C.15}
stepper.directionPins={D.0,D.5,E.0,E.4,C.14}
stepper.numSmartDrivers=5
stepper.TmcUartPins={A.15,D.4,B.7,E.3,C.13}
stepper.spiChannel=2
power.VInDetectPin=C.3
sbc.TfrReadyPin=B.11
sbc.csPin=B.12
sbc.spiChannel=1
sbc.sbcMode=1
heat.tempSensePins={A.3,A.4,A.1}`,
    }),

    [STM32BoardType.Fly_C8Pro]: makeBoard({
        shortName: "c8p_1_0_h723", longName: "Fly C8 Pro V1.0 STM32H723", manufacturer: "Fly",
        numDrivers: 8,
        hasWiFi: false, hasSBC: true, hasVin: true,
        hidden: true,
        thermistors: ["bedtemp", "e0temp", "e1temp", "e2temp"],
        heaters:     ["bed", "e0heat", "e1heat", "e2heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5"],
        endstops:    ["xstop", "xstopmax", "ystop", "ystopmax", "zstop", "zstopmax", "probe"],
        servos:      ["servo"],
        gpOut:       ["laser"],
        neopixelPins: ["neopixel"],
        serialOptions: [
            { label: "LCD/EXP1 Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=c8p_1_0_h723
board.longName="Fly C8 Pro V1.0 STM32H723"
sdcard.internal.type=255
SPI0.pins={NoPin,NoPin,NoPin}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={A.15,C.12,D.2,D.5,B.6,C.14,E.10,A.6}
stepper.stepPins={E.5,E.4,E.3,E.2,E.1,E.0,E.7,E.8}
stepper.directionPins={A.8,C.11,D.1,D.4,D.7,C.13,E.11,A.7}
stepper.numSmartDrivers=8
stepper.TmcUartPins={C.9,C.10,D.0,D.3,D.6,B.7,C.15,E.9}
stepper.spiChannel=2
power.VInDetectPin=C.1
sbc.TfrReadyPin=E.13
sbc.csPin=B.12
sbc.spiChannel=1
sbc.sbcMode=1
heat.tempSensePins={C.5,C.2,C.3,C.4}`,
    }),


    [STM32BoardType.Fly_E3Ultra]: makeBoard({
        shortName: "e3ultra_h723", longName: "Fly E3 Ultra STM32H723", manufacturer: "Fly",
        displays: { reprapdiscount: 5, ender3: 4, fysetc12864: 2 },
        diagPins: ["D.12", "B.10", "C.4"],
        notes: [
            "Thermistor inputs use a 2.2k pull-up (not 4.7k); this is pre-configured in RRF 3.5.0+.",
            "Both 24V inputs must be connected: the right input powers the MCU/WiFi, the left powers motors/heaters/bed.",
            "Maximum input voltage 32V. If only one Z output is used, fit the jumpers on the unused Z output.",
            "Ships without firmware — the board appears as an unidentified USB device until flashed.",
        ],
        numDrivers: 5,
        hasWiFi: true, hasSBC: false, hasVin: true,
        builtInDrivers: true,
        accelPreset: { spiChannel: 2, csPin: "B.2", intPin: "A.10" },
        spiChannelLocks: { 1: "WiFi" },
        thermistors: ["e0temp", "e1temp", "bedtemp", "boardtemp"],
        heaters:     ["bed", "e0heat", "e1heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3"],
        endstops:    ["xstop", "ystop", "zstop", "probe"],
        gpIn:        ["pwrdet"],
        servos:      ["servo0"],
        gpOut:       ["laser", "pson"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "E.13", tfrReadyPin: "E.14", espResetPin: "E.15",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "LCD/EXP Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=e3ultra_h723
board.longName="Fly E3 Ultra STM32H723"
sdcard.internal.type=2
SPI0.pins={A.4,A.5,A.6}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={E.10,NoPin,E.8}
SPI5.pins={E.9,NoPin,A.14}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={E.5,E.1,C.2,D.6,C.15}
stepper.stepPins={E.3,D.1,A.15,D.4,C.13}
stepper.directionPins={E.2,D.0,D.7,D.3,C.0}
stepper.numSmartDrivers=5
stepper.TmcUartPins={E.4,E.0,A.8,D.5,C.14}
power.VInDetectPin=C.3
sbc.TfrReadyPin=NoPin
sbc.csPin=NoPin
sbc.spiChannel=255
wifi.espDataReadyPin=E.13
wifi.TfrReadyPin=E.14
wifi.espResetPin=E.15
wifi.serialRxTxPins={D.9, D.8}
wifi.moduleType=esp32
heat.tempSensePins={A.3,A.4,A.1}
heat.thermistorSeriesResistor = 2200
heat.spiTempSensorChannel=0
heat.spiTempSensorCSPins={D.13,C.7}`,
    }),

    [STM32BoardType.Fly_Super5]: makeBoard({
        shortName: "super5_h723", longName: "Fly Super5 STM32H723", manufacturer: "Fly",
        displays: { reprapdiscount: 5, fysetc12864: 2 },
        diagPins: ["B.7", "C.12", "C.7", "C.14", "C.6"],
        notes: [
            "Thermistor inputs use a 2.2k pull-up — add R2200 to every M308 thermistor command.",
            "Power must be connected to 'Power In Bed' even if the bed output is unused.",
            "No diag-disable jumper: designed for Fly-2209 drivers (onboard diag switch). With other drivers used for endstops, physically remove/bend the diag pin.",
            "Endstop voltage defaults to 0V — fit a jumper to select 5V or 12V. Fan voltage is jumper-selectable (5V / 12V / Vin). Ships without firmware.",
        ],
        numDrivers: 5,
        hasWiFi: true, hasSBC: true, hasVin: true,
        accelPreset: { spiChannel: 2, csPin: "B.6", intPin: "D.6" },
        thermistors: ["adc0", "adc1", "adc2"],
        heaters:     ["bed", "heat0", "heat1"],
        fans:        ["fan0", "fan1", "fan2", "fan3"],
        endstops:    ["io0", "io1", "io2", "io3", "io4", "io5", "probe"],
        servos:      ["servo0"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "D.10", tfrReadyPin: "D.11", espResetPin: "D.14",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "LCD/EXP Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=super5_h723
board.longName="Fly Super5 STM32H723"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={D.0,NoPin,A.15}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={B.11,E.13,E.9,C.1,E.3}
stepper.stepPins={E.14,E.11,E.7,E.4,E.1}
stepper.directionPins={E.15,E.12,E.8,E.5,E.2}
stepper.numSmartDrivers=5
stepper.TmcUartPins={B.10,E.10,A.4,C.0,E.0}
stepper.spiChannel=0
power.VInDetectPin=C.3
sbc.TfrReadyPin=D.11
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=D.10
wifi.TfrReadyPin=D.11
wifi.espResetPin=D.14
wifi.serialRxTxPins={D.9, D.8}
wifi.moduleType=esp32
heat.tempSensePins={C.4,C.5,B.1}
heat.thermistorSeriesResistor = 2200`,
    }),

    [STM32BoardType.Fly_Super8Pro_H723]: makeBoard({
        shortName: "super8pro_h723", longName: "Fly Super8 Pro STM32H723", manufacturer: "Fly",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["G.12", "G.11", "G.10", "G.9", "D.7", "D.6", "A.8", "F.3"],
        notes: [
            "Ships WITHOUT fuses fitted, and they differ from the AliExpress listing — fit them as pictured in the docs before powering on.",
            "No diag-disable jumper unless using Fly-2209 drivers; with other drivers used for endstops, physically remove/bend the diag pin.",
            "Driver signal and IO voltages are jumper-selectable (3.3V / 5V / 12V, default 5V). Fan voltage is jumper-selectable (5V / 12V / Vin).",
        ],
        numDrivers: 8,
        hasWiFi: true, hasSBC: true, hasVin: true,
        accelPreset: { spiChannel: 3, csPin: "D.1", intPin: "D.0" },
        spiChannelLocks: { 1: "WiFi" },
        thermistors: ["adc0", "adc1", "adc2", "adc3", "adc4", "adc5"],
        heaters:     ["bed", "heat0", "heat1", "heat2", "heat3", "heat4"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5", "fan6", "fan7", "fan8", "fan9"],
        endstops:    ["io0", "io1", "io2", "io3", "io4", "io5", "io6", "probe"],
        gpIn:        ["hvin"],
        servos:      ["servo"],
        gpOut:       ["out0", "out1", "out2", "out3", "out4", "out5", "pwmout1"],
        uart:        ["tx1"],
        wifiConfig: {
            espDataReadyPin: "D.13", tfrReadyPin: "D.11", espResetPin: "D.10",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "TFT/AUX Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=super8pro_h723
board.longName="Fly Super8 Pro STM32H723"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={D.3,D.4,D.5}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={C.14,NoPin,B.2}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={F.11,F.14,G.1,E.9,F.2,C.15,G.4,G.7}
stepper.stepPins={E.2,E.3,E.4,E.14,E.15,E.1,E.0,E.6}
stepper.directionPins={C.5,F.13,G.0,E.8,E.11,F.0,G.3,G.6}
stepper.numSmartDrivers=8
stepper.TmcUartPins={C.4,F.12,F.15,E.7,E.10,F.1,G.2,G.5}
stepper.spiChannel=2
power.VInDetectPin=C.2
sbc.TfrReadyPin=G.15
sbc.csPin=A.4
sbc.spiChannel=0
wifi.espDataReadyPin=D.13
wifi.TfrReadyPin=D.11
wifi.espResetPin=D.10
wifi.serialRxTxPins={D.9, D.8}
wifi.moduleType=esp32
heat.tempSensePins={F.4,F.5,F.9,F.10,C.0,C.1}`,
    }),

    [STM32BoardType.Fly_Super8Pro_H743]: makeBoard({
        shortName: "super8pro_h743", longName: "Fly Super8 Pro STM32H743", manufacturer: "Fly",
        displays: { reprapdiscount: 5, fysetc12864: 0 },
        diagPins: ["G.12", "G.11", "G.10", "G.9", "D.7", "D.6", "A.8", "F.3"],
        notes: [
            "Ships WITHOUT the RRF bootloader — the bootloader must be flashed before the firmware.",
            "No diag-disable jumper unless using Fly-2209 drivers; with other drivers used for endstops, physically remove/bend the diag pin.",
            "Driver signal and IO voltages are jumper-selectable (3.3V / 5V / 12V, default 5V). Fan voltage is jumper-selectable (5V / 12V / Vin).",
        ],
        numDrivers: 8,
        hasWiFi: true, hasSBC: true, hasVin: true,
        accelPreset: { spiChannel: 3, csPin: "D.1", intPin: "D.0" },
        spiChannelLocks: { 1: "WiFi" },
        thermistors: ["adc0", "adc1", "adc2", "adc3", "adc4", "adc5"],
        heaters:     ["bed", "heat0", "heat1", "heat2", "heat3", "heat4"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5", "fan6", "fan7", "fan8", "fan9"],
        endstops:    ["io0", "io1", "io2", "io3", "io4", "io5", "io6", "probe"],
        gpIn:        ["hvin"],
        servos:      ["servo"],
        gpOut:       ["out0", "out1", "out2", "out3", "out4", "out5", "pwmout1"],
        uart:        ["tx1"],
        wifiConfig: {
            espDataReadyPin: "D.13", tfrReadyPin: "D.11", espResetPin: "D.10",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "TFT/AUX Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=super8pro_h743
board.longName="Fly Super8 Pro STM32H743"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={B.3,B.4,B.5}
SPI3.pins={D.3,D.4,D.5}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={C.14,NoPin,B.2}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={F.11,F.14,G.1,E.9,F.2,C.15,G.4,G.7}
stepper.stepPins={E.2,E.3,E.4,E.14,E.15,E.1,E.0,E.6}
stepper.directionPins={C.5,F.13,G.0,E.8,E.11,F.0,G.3,G.6}
stepper.numSmartDrivers=8
stepper.TmcUartPins={C.4,F.12,F.15,E.7,E.10,F.1,G.2,G.5}
stepper.spiChannel=2
power.VInDetectPin=C.2
sbc.TfrReadyPin=G.15
sbc.csPin=A.4
sbc.spiChannel=0
wifi.espDataReadyPin=D.13
wifi.TfrReadyPin=D.11
wifi.espResetPin=D.10
wifi.serialRxTxPins={D.9, D.8}
wifi.moduleType=esp32
heat.tempSensePins={F.4,F.5,F.9,F.10,C.0,C.1}`,
    }),

    [STM32BoardType.Fly_ProX10_H723]: makeBoard({
        shortName: "prox10_h723", longName: "Fly Pro X10 STM32H723", manufacturer: "Fly",
        diagPins: ["G.8", "G.7", "G.6", "G.5", "G.4", "G.3", "G.2", "B.1", "F.9", "C.6"],
        notes: [
            "Each driver has a jumper to select its power source (HVIN or VIN).",
            "Driver 9's DIAG pin is shared with the BLTouch probe pin; other DIAG pins share the IO connectors — watch for conflicts when using sensorless homing.",
            "IO voltage is jumper-selectable (5V / 12V); fan voltage is jumper-selectable (5V / 12V / Vin). Ships without firmware.",
        ],
        numDrivers: 10,
        hasWiFi: true, hasSBC: false, hasVin: true,
        spiChannelLocks: { 1: "WiFi" },
        thermistors: ["adc0", "adc1", "adc2", "adc3", "adc4", "adc5"],
        heaters:     ["bed", "heat0", "heat1", "heat2", "heat3", "heat4"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4", "fan5", "fan6", "fan7"],
        endstops:    ["io0", "io1", "io2", "io3", "io4", "io5", "io6", "probe"],
        gpIn:        ["hvin"],
        servos:      ["servo"],
        gpOut:       ["out0", "out1", "out3", "out4", "out5", "pwmout1", "fan6pwm", "fan7pwm"],
        uart:        ["tx1"],
        wifiConfig: {
            espDataReadyPin: "D.13", tfrReadyPin: "D.11", espResetPin: "D.10",
            serialRxPin: "D.9", serialTxPin: "D.8",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "AUX Header (UART1 — A.10/A.9)", rx: "A.10", tx: "A.9" },
        ],
        boardTxtContent: `board=prox10_h723
board.longName="Fly Pro X10 STM32H723"
sdcard.internal.type=2
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
SPI6.pins={NoPin,NoPin,NoPin}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={G.10,E.13,G.0,F.13,B.2,C.0,F.4,F.0,C.13,G.15}
stepper.stepPins={E.7,E.8,E.9,E.10,E.11,E.2,E.3,E.4,E.1,E.0}
stepper.directionPins={G.11,E.14,G.1,F.14,F.11,F.10,F.2,C.15,B.7,C.14}
stepper.numSmartDrivers=10
stepper.TmcUartPins={G.12,E.15,E.12,F.15,F.12,F.5,F.1,G.14,B.6,G.13}
stepper.spiChannel=0
power.VInDetectPin=C.2
wifi.espDataReadyPin=D.13
wifi.TfrReadyPin=D.11
wifi.espResetPin=D.10
wifi.serialRxTxPins={D.9, D.8}
wifi.moduleType=esp32
heat.tempSensePins={C.5,C.4,A.4,B.0,C.1}`,
    }),

    // ── Fysetc ─────────────────────────────────────────────────────────────

    [STM32BoardType.Fysetc_SpiderKing_H723]: makeBoard({
        shortName: "spiderking_h723", longName: "Fysetc Spider King STM32H723", manufacturer: "Fysetc",
        numDrivers: 10,
        hasWiFi: true, hasSBC: true, hasVin: false,
        accelPreset: { spiChannel: 0, csPin: "A.4", intPin: "B.10" },
        thermistors: ["e0temp", "e1temp", "e2temp", "e3temp", "e4temp", "bedtemp"],
        heaters:     ["bed", "e0heat", "e1heat", "e2heat", "e3heat", "e4heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3", "fan4"],
        fanTachos:   ["tacho0", "tacho1"],
        endstops:    ["xstop", "xstopmax", "ystop", "ystopmax", "zstop", "zstopmax", "probe"],
        servos:      ["servo0"],
        wifiConfig: {
            espDataReadyPin: "G.2", tfrReadyPin: "G.1", espResetPin: "B.3",
            serialRxPin: "A.10", serialTxPin: "A.9",
            moduleType: "esp32", dedicated: true,
        },
        serialOptions: [
            { label: "AUX Header (UART1 — A.10/A.9, shared with WiFi module)", rx: "A.10", tx: "A.9", noAutoSelect: true },
        ],
        boardTxtContent: `board=spiderking_h723
board.longName="Fysetc Spider King STM32H723"
sdcard.internal.type=1
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={C.10,C.11,C.12}
SPI3.pins={E.12,E.13,E.14}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={E.11,G.10,G.15,D.5,E.6,E.2,G.9,B.2,F.2,G.5}
stepper.stepPins={G.7,D.11,G.14,D.4,E.5,E.3,G.13,E.1,F.4,F.15}
stepper.directionPins={G.6,D.10,G.12,D.6,C.13,E.4,G.8,E.0,F.3,G.0}
stepper.numSmartDrivers=10
stepper.TmcUartPins={D.2,E.15,D.8,D.7,C.14,C.15,G.3,D.9,F.5,G.11}
power.VInDetectPin=NoPin
sbc.TfrReadyPin=B.11
sbc.csPin=B.12
sbc.spiChannel=1
wifi.espDataReadyPin=G.2
wifi.TfrReadyPin=G.1
wifi.espResetPin=B.3
wifi.serialRxTxPins={A.10, A.9}
wifi.moduleType=esp32
heat.tempSensePins={A.0,A.1,A.2,A.3}
serial.aux.rxTxPins={NoPin,NoPin}`,
    }),

    [STM32BoardType.Fysetc_SpiderV3]: makeBoard({
        shortName: "spiderv3_h723", longName: "Fysetc Spider V3 STM32H723", manufacturer: "Fysetc",
        numDrivers: 8,
        hasWiFi: true, hasSBC: false, hasVin: false,
        accelPreset: { spiChannel: 0, csPin: "A.4", intPin: "B.10" },
        thermistors: ["e0temp", "e1temp", "e2temp", "e3temp", "bedtemp", "e4temp"],
        heaters:     ["bed", "e1heat", "e2heat"],
        fans:        ["fan0", "fan1", "fan2"],
        endstops:    ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"],
        gpOut:       ["LED.R", "LED.G", "LED.B"],
        neopixelPins: ["neopixel"],
        wifiConfig: {
            espDataReadyPin: "A.8", tfrReadyPin: "C.9", espResetPin: "D.2",
            serialRxPin: "A.10", serialTxPin: "A.9",
            spiChannel: 2, spiCsPin: "C.6",
            moduleType: "esp32",
        },
        serialOptions: [
            { label: "AUX Header (UART1 — A.10/A.9, shared with WiFi module)", rx: "A.10", tx: "A.9", noAutoSelect: true },
        ],
        boardTxtContent: `board=spiderv3_h723
board.longName="Fysetc Spider V3 STM32H723"
sdcard.internal.type=1
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={NoPin,NoPin,NoPin}
SPI2.pins={C.10,C.11,C.12}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
SPI6.pins={E.12,E.13,E.14}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={E.9,D.9,D.15,D.4,E.5,E.3,E.8,C.5}
stepper.stepPins={E.11,D.8,D.14,D.5,E.6,E.2,D.12,E.1}
stepper.directionPins={E.10,B.12,D.13,D.6,C.13,E.4,C.4,E.0}
stepper.numSmartDrivers=8
stepper.TmcUartPins={E.7,E.15,D.10,D.7,C.14,C.15,A.15,D.11}
power.VInDetectPin=NoPin
sbc.TfrReadyPin=NoPin
sbc.csPin=NoPin
sbc.spiChannel=255
wifi.espDataReadyPin=A.8
wifi.TfrReadyPin=C.9
wifi.espResetPin=D.2
wifi.csPin=C.6
wifi.serialRxTxPins={A.10, A.9}
wifi.moduleType=esp32
wifi.spiChannel=2
heat.tempSensePins={C.0,C.1,C.2,C.3,B.1,B.0}
serial.aux.rxTxPins={NoPin,NoPin}
can.writePin=D.1
can.readPin=D.0`,
    }),


    // ── LDO ────────────────────────────────────────────────────────────────

    [STM32BoardType.LDO_Leviathan_H723]: makeBoard({
        shortName: "leviathan1_3_h723", longName: "LDO Leviathan v1.3 STM32H723", manufacturer: "LDO",
        numDrivers: 7,
        hasWiFi: false, hasSBC: true, hasVin: false,
        builtInDrivers: true,
        thermistors: ["temp0", "temp1", "temp2", "temp3"],
        heaters:     ["bed", "e0heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3"],
        fanTachos:   ["fan0.tacho", "fan1.tacho", "fan2.tacho", "fan3.tacho"],
        endstops:    ["xstop", "ystop", "zstop", "probe", "e0stop"],
        neopixelPins: ["neopixel", "ledstrip"],
        serialOptions: [],
        boardTxtContent: `board=leviathan1_3_h723
board.longName="LDO Leviathan v1.3 STM32H723"
sdcard.internal.type=255
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
SPI6.pins={E.12,E.13,E.14}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={G.0,E.9,D.7,D.2,C.10,C.7,D.13}
stepper.stepPins={B.10,F.15,D.4,C.12,C.9,G.7,D.10}
stepper.directionPins={B.11,F.14,D.3,C.11,C.8,G.6,D.9}
stepper.numSmartDrivers=7
stepper.num5160Drivers=2
stepper.TmcUartPins={E.15,E.11,D.5,D.0,A.8,G.8,D.11}
stepper.TmcDiagPins={G.1,E.10,D.6,D.1,A.15,C.6,D.12}
stepper.spiChannel=6
power.VInDetectPin=NoPin
sbc.TfrReadyPin=D.14
sbc.csPin=B.12
sbc.spiChannel=1
sbc.sbcMode=1
heat.tempSensePins={A.1,A.2,A.0,A.3}
can.writePin=B.6
can.readPin=B.5
heat.thermistorSeriesResistor=2200`,
    }),

    [STM32BoardType.LDO_Leviathan_H743]: makeBoard({
        shortName: "leviathan1_3_h743", longName: "LDO Leviathan v1.3 STM32H743", manufacturer: "LDO",
        numDrivers: 7,
        hasWiFi: false, hasSBC: true, hasVin: false,
        builtInDrivers: true,
        thermistors: ["temp0", "temp1", "temp2", "temp3"],
        heaters:     ["bed", "e0heat"],
        fans:        ["fan0", "fan1", "fan2", "fan3"],
        fanTachos:   ["fan0.tacho", "fan1.tacho", "fan2.tacho", "fan3.tacho"],
        endstops:    ["xstop", "ystop", "zstop", "probe", "e0stop"],
        neopixelPins: ["neopixel", "ledstrip"],
        serialOptions: [],
        boardTxtContent: `board=leviathan1_3_h743
board.longName="LDO Leviathan v1.3 STM32H743"
sdcard.internal.type=255
SPI0.pins={A.5,A.6,A.7}
SPI1.pins={B.13,B.14,B.15}
SPI2.pins={NoPin,NoPin,NoPin}
SPI3.pins={NoPin,NoPin,NoPin}
SPI4.pins={NoPin,NoPin,NoPin}
SPI5.pins={NoPin,NoPin,NoPin}
SPI6.pins={E.12,E.13,E.14}
SPI7.pins={NoPin,NoPin,NoPin}
SPI8.pins={NoPin,NoPin,NoPin}
stepper.powerEnablePin=NoPin
stepper.enablePins={G.0,E.9,D.7,D.2,C.10,C.7,D.13}
stepper.stepPins={B.10,F.15,D.4,C.12,C.9,G.7,D.10}
stepper.directionPins={B.11,F.14,D.3,C.11,C.8,G.6,D.9}
stepper.numSmartDrivers=7
stepper.num5160Drivers=2
stepper.TmcUartPins={E.15,E.11,D.5,D.0,A.8,G.8,D.11}
stepper.TmcDiagPins={G.1,E.10,D.6,D.1,A.15,C.6,D.12}
stepper.spiChannel=6
power.VInDetectPin=NoPin
sbc.TfrReadyPin=D.14
sbc.csPin=B.12
sbc.spiChannel=1
sbc.sbcMode=1
heat.tempSensePins={A.1,A.2,A.0,A.3}
can.writePin=B.6
can.readPin=B.5
heat.thermistorSeriesResistor=2200`,
    }),
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getSTM32BoardType(shortName: string | null | undefined): STM32BoardType | null {
    if (!shortName) return null;
    for (const [type, descriptor] of Object.entries(STM32Boards)) {
        if (descriptor.objectModelBoard.shortName === shortName) {
            return type as STM32BoardType;
        }
    }
    return null;
}

export function getSTM32BoardDefinition(shortName: string | null | undefined): STM32BoardDescriptor | null {
    if (!shortName) return null;
    for (const descriptor of Object.values(STM32Boards)) {
        if (descriptor.objectModelBoard.shortName === shortName) {
            return descriptor;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Firmware download (STM32 / community boards)
// ---------------------------------------------------------------------------

/**
 * Individual STM32 / community firmware files live in the gloomyandy/RRFBuild repo tree
 * (NOT as GitHub release assets — those are whole-bundle zips). They sit under
 * releases/<version>/{mainboard/<oem>,expansion,wifi}/.
 */
export const STM32_FIRMWARE_REPO = "gloomyandy/RRFBuild";
export const STM32_FIRMWARE_BRANCH = "v3.6-dev";

/**
 * RP2040-based community toolboards. Their firmware is published as
 * Duet3Firmware_<shortName>.uf2 in the releases/<ver>/expansion/ folder.
 * Everything else (STM32 mainboards + STM32 expansion-mode boards) is
 * firmware_<shortName>.bin in releases/<ver>/mainboard/<oem>/.
 */
const RP2040_TOOLBOARD_SHORTNAMES = new Set<string>([
    "FLY36RRF", "FLYM2", "FSSB2040V2", "PITBV2_0",
    "SB2040MAX3", "SB2040PROMAX3", "SHT36MAX3", "SHT36V3", "STRIDEMAXV2_0",
]);

/**
 * STM32H7 boards that run in CAN expansion mode (defined in ExpansionBoards.ts, not
 * STM32Boards). Their firmware follows the STM32 firmware_<shortName>.bin convention
 * (they live under releases/<ver>/mainboard/<oem>/).
 */
const STM32_EXPANSION_SHORTNAMES = new Set<string>([
    "afclite1_h723", "mmu_h723", "longboi1_h723", "d8_pro_h723",
]);

/** Result of resolving a board's firmware file. */
export interface FirmwareFileInfo {
    /** Exact filename as published in the RRFBuild release tree. */
    fileName: string;
    /** True for RP2040 .uf2 toolboard firmware (already Duet3Firmware_-prefixed). */
    isUf2: boolean;
}

/**
 * Boards whose published firmware basename does not follow firmware_<shortName>.bin.
 * (e.g. the Fly C5's objectModel shortName is "c5_1_0" but the firmware is
 * firmware_c5_1_0_h723.bin in the release tree.)
 */
const FIRMWARE_NAME_OVERRIDES: Record<string, string> = {
    "c5_1_0": "firmware_c5_1_0_h723.bin",
};

/**
 * Resolve the firmware filename for a board shortName, or null for boards with no
 * community firmware (e.g. a Duet mainboard, which uses the existing /assets flow).
 */
export function getSTM32FirmwareFile(shortName: string | null | undefined): FirmwareFileInfo | null {
    if (!shortName) return null;
    if (RP2040_TOOLBOARD_SHORTNAMES.has(shortName)) {
        return { fileName: `Duet3Firmware_${shortName}.uf2`, isUf2: true };
    }
    if (getSTM32BoardDefinition(shortName) !== null || STM32_EXPANSION_SHORTNAMES.has(shortName)) {
        return { fileName: FIRMWARE_NAME_OVERRIDES[shortName] ?? `firmware_${shortName}.bin`, isUf2: false };
    }
    return null;
}

/**
 * WiFi server firmware filename for the selected module type.
 * esp32eth uses the Ethernet build; everything else uses the standard ESP32 build.
 */
export function getSTM32WifiFile(moduleType: string | null | undefined): string {
    return (moduleType === "esp32eth") ? "WiFiModule_esp32eth.bin" : "WiFiModule_esp32.bin";
}

/**
 * IAP (in-application programming) bootstrap filename for an STM32 mainboard, used when
 * running in SBC mode. The IAP is MCU-specific, not board-specific: H723, H743 or F4.
 * Returns null for non-STM32 boards or boards with no IAP.
 */
export function getSTM32IapFile(shortName: string | null | undefined): string | null {
    if (!shortName || getSTM32BoardDefinition(shortName) === null) {
        return null;
    }
    // All currently-supported STM32 mainboards are H723 or H743; the Fly C5 shortName
    // ("c5_1_0") omits the suffix but is an H723 board.
    if (shortName.endsWith("_h743")) return "stm32h743_iap_SBC.bin";
    if (shortName.endsWith("_h723")) return "stm32h723_iap_SBC.bin";
    if (shortName === "c5_1_0")      return "stm32h723_iap_SBC.bin";
    return "stm32f4_iap_SBC.bin";
}
