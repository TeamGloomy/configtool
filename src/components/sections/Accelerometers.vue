<style scoped>
.table-accelerometer-boards tr > td {
    vertical-align: middle;
}
</style>

<template>
    <config-section board-txt :type="ConfigSectionType.Accelerometers" title="Accelerometers" url-title="Connecting an accelerometer"
                    url="https://docs.duet3d.com/en/User_manual/Connecting_hardware/Sensors_Accelerometer">
        <!-- STM32 mainboard accelerometer (SPI channel assigned in the SPI Configuration section) -->
        <div v-if="isStm32" class="row g-3">
            <template v-if="stm32AccelChannel < 0">
                <div class="col-12">
                    <div class="alert alert-warning mb-0 py-2 small">
                        <i class="bi-exclamation-triangle me-1"></i>
                        To configure an accelerometer, set a SPI channel's <strong>Role</strong> to
                        "Accelerometer" in the <a href="#spiConfig">SPI Configuration</a> section above.
                        <template v-if="stm32AccelPreset"> Suggested channel for this board: SPI{{ stm32AccelPreset.spiChannel }}.</template>
                    </div>
                </div>
            </template>
            <template v-else>
                <div class="col-12 small text-muted">
                    Accelerometer on <strong>SPI channel {{ stm32AccelChannel }}</strong> (assigned in
                    <a href="#spiConfig">SPI Configuration</a>). Supported types are auto-detected: LIS3DH, LIS3DSH, LIS2DW12.
                </div>
                <div class="col-auto">
                    <text-input label="SPI CS Pin" title="Chip-select pin connected to the accelerometer"
                                v-model="store.data.configTool.stm32AccelCsPin"
                                :preset="stm32AccelPreset?.csPin ?? ''" :max-length="8" placeholder="e.g. D.14" />
                </div>
                <div class="col-auto">
                    <text-input label="INT1 Pin" title="Interrupt pin (optional but recommended for best performance)"
                                v-model="store.data.configTool.stm32AccelIntPin"
                                :preset="stm32AccelPreset?.intPin ?? ''" :max-length="8" :required="false" placeholder="e.g. G.3" />
                </div>
                <div class="col">
                    <select-input label="Orientation" title="Accelerometer orientation (M955 I parameter)"
                                  :options="OrientationOptions"
                                  v-model="store.data.configTool.stm32AccelOrientation" :preset="20" />
                </div>
            </template>
        </div>

        <template #append>
            <table v-if="accelerometerBoards.length > 0" class="table table-striped table-accelerometer-boards mt-n1 mb-0">
                <colgroup>
                    <col style="width: auto;">
                    <col style="width: 25%;">
                    <col style="width: 35%;">
                    <col style="width: 20%;">
                    <col style="width: 20%;">
                </colgroup>
                <thead>
                    <tr>
                        <th class="text-center text-nowrap">
                            CAN Address
                        </th>
                        <th>
                            Accelerometer Type
                        </th>
                        <th>
                            Orientation
                        </th>
                        <th>
                            SPI CS Port
                        </th>
                        <th>
                            INT Port
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="board in accelerometerBoards">
                        <td class="text-center">
                            {{ board.canAddress ?? "n/a" }}
                        </td>
                        <td>
                            <select-input title="Type of the connected accelerometer" :options="getAccelerometerTypes(board)"
                                          :required="false" :model-value="getAccelerometerModel(board)"
                                          @update:model-value="setAccelerometerModel(board, $event)" />
                        </td>
                        <td>
                            <select-input title="Orientation of the accelerometer board, see docs for further info (I parameter)"
                                          :options="OrientationOptions" :model-value="getAccelerometerOrientation(board)"
                                          @update:model-value="setAccelerometerOrientation(board, $event)" />
                        </td>
                        <td>
                            <port-input :board="board.canAddress" :function="ConfigPortFunction.accelerometerSpiCs"
                                        :index="board.canAddress ?? 0" :disabled="getAccelerometerModel(board) === null"
                                        :required="!hasBuiltInAccelerometer(board)" />
                        </td>
                        <td>
                            <port-input :board="board.canAddress" :function="ConfigPortFunction.accelerometerInt"
                                        :index="board.canAddress ?? 0" :disabled="getAccelerometerModel(board) === null"
                                        :required="!hasBuiltInAccelerometer(board)" />
                        </td>
                    </tr>
                </tbody>
            </table>

            <div v-else-if="!isStm32" class="alert alert-info mb-0">
                <i class="bi-info-circle"></i>
                No boards with accelerometer support
            </div>

            <div v-if="store.data.boards.some(board => getExpansionBoardType(board) === ExpansionBoardType.TOOL1LC)"
                 class="alert alert-info mb-0">
                <i class="bi-info-circle"></i>
                Only toolboards with revision 1.1 or later have an on-board accelerometer
            </div>
        </template>
    </config-section>
</template>

<script lang="ts">
import type { SelectOption } from "@/components/inputs/SelectInput.vue";
import { ExpansionBoardType } from "@/store/ExpansionBoards";

export const OrientationOptions: Array<SelectOption> = [
    {
        text: "+X to +Y / +Z to +X (I01)",
        value: 1
    },
    {
        text: "+X to +Z / +Z to +X (I02)",
        value: 2
    },
    {
        text: "+X to -Y / +Z to +X (I05)",
        value: 5
    },
    {
        text: "+X to -Z / +Z to +X (I06)",
        value: 6
    },
    {
        text: "+X to +X / +Z to +Y (I10)",
        value: 10
    },
    {
        text: "+X to +Z / +Z to +Y (I12)",
        value: 12
    },
    {
        text: "+X to -X / +Z to +Y (I14)",
        value: 14
    },
    {
        text: "+X to -Z / +Z to +Y (I16)",
        value: 16
    },
    {
        text: "+X to +X / +Z to +Z (I20)",
        value: 20
    },
    {
        text: "+X to +Y / +Z to +Z (I21)",
        value: 21
    },
    {
        text: "+X to -X / +Z to +Z (I24)",
        value: 24
    },
    {
        text: "+X to -Y / +Z to +Z (I25)",
        value: 25
    },
    {
        text: "+X to +Y / +Z to -X (I41)",
        value: 41
    },
    {
        text: "+X to +Z / +Z to -X (I42)",
        value: 42
    },
    {
        text: "+X to -Y / +Z to -X (I45)",
        value: 45
    },
    {
        text: "+X to -Z / +Z to -X (I46)",
        value: 46
    },
    {
        text: "+X to +X / +Z to -Y (I50)",
        value: 50
    },
    {
        text: "+X to +Z / +Z to -Y (I52)",
        value: 52
    },
    {
        text: "+X to -X / +Z to -Y (I54)",
        value: 54
    },
    {
        text: "+X to -Z / +Z to -Y (I56)",
        value: 56
    },
    {
        text: "+X to +X / +Z to -Z (I60)",
        value: 60
    },
    {
        text: "+X to +Y / +Z to -Z (I61)",
        value: 61
    },
    {
        text: "+X to -X / +Z to -Z (I64)",
        value: 64
    },
    {
        text: "+X to -Y / +Z to -Z (I65)",
        value: 65
    }
];

</script>

<script setup lang="ts">
import { Accelerometer, type Board } from "@duet3d/objectmodel";
import { computed } from "vue";

import ConfigSection from "@/components/ConfigSection.vue";
import SelectInput from "@/components/inputs/SelectInput.vue";
import PortInput from "@/components/inputs/PortInput.vue";
import TextInput from "@/components/inputs/TextInput.vue";

import { useStore } from "@/store";
import { ConfigSectionType } from "@/store/sections";
import { getBoardDefinition } from "@/store/Boards";
import { getExpansionBoardDefinition, getExpansionBoardType } from "@/store/ExpansionBoards";
import { isSTM32BoardType, type STM32BoardDescriptor } from "@/store/STM32Boards";
import { ConfigPortFunction } from "@/store/model/ConfigPort";

const store = useStore();

// STM32 mainboard accelerometer — the SPI channel is assigned in the SPI Configuration
// section (Role = Accelerometer); the wiring + orientation are configured here.
const isStm32 = computed(() => {
    const bt = store.data.boardType;
    return bt !== null && isSTM32BoardType(bt);
});
const stm32AccelPreset = computed(() =>
    isStm32.value ? ((store.data.boardDefinition as STM32BoardDescriptor | null)?.accelPreset ?? null) : null
);
const stm32AccelChannel = computed(() => store.data.configTool.stm32AccelSpiChannel);

const accelerometerBoards = computed(() => {
    const result: Array<Board> = [];
    if (getBoardDefinition(store.data)?.supportsAccelerometer) {
        result.push(store.data.boards[0]);
    }
    for (const board of store.data.boards) {
        if (getExpansionBoardDefinition(board)?.supportsAccelerometer) {
            result.push(board);
        }
    }
    return result;
});

function hasBuiltInAccelerometer(board: Board) {
    return board.canAddress && (getExpansionBoardDefinition(board as Board)?.hasBuiltInAccelerometer ?? false);
}

function getAccelerometerType(board: Board): string {
    return (getExpansionBoardType(board) === ExpansionBoardType.TOOL1RR) ? "LIS2DW12" : "LIS3DH";
}

function getAccelerometerTypes(board: Board): Array<SelectOption> {
    const type = getAccelerometerType(board);
    return [
        { text: "None", value: null },
        { text: type, value: type }
    ];
}

function getAccelerometerModel(board: Board) {
    return (board.accelerometer !== null) ? getAccelerometerType(board) : null;
}

function setAccelerometerModel(board: Board, value: string | null) {
    board.accelerometer = (value !== null) ? new Accelerometer() : null;
    if (value === null) {
        for (const port of store.data.configTool.ports) {
            if ([ConfigPortFunction.accelerometerInt, ConfigPortFunction.accelerometerSpiCs].includes(port.function!) && port.index === (board.canAddress ?? 0)) {
                // Release ports of the deleted accelerometer
                port.function = null;
            }
        }
    }
}

function getAccelerometerOrientation(board: Board) {
    return (board.accelerometer !== null) ? board.accelerometer.orientation : 20;
}

function setAccelerometerOrientation(board: Board, value: number) {
    if (board.accelerometer !== null) {
        board.accelerometer.orientation = value;
    }
}
</script>