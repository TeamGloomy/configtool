<style scoped>
.table-accelerometer-boards tr > td {
    vertical-align: middle;
}
</style>

<template>
    <config-section :type="ConfigSectionType.Accelerometers" title="Accelerometers" url-title="Connecting an accelerometer"
                    url="https://docs.duet3d.com/en/User_manual/Connecting_hardware/Sensors_Accelerometer">
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
                        <th v-if ="store.data.boards[0].name.startsWith('Duet')">
                            SPI CS Port
                        </th>
                        <th v-if ="store.data.boards[0].name.startsWith('Duet')">
                            INT Port
                        </th>
                        <th v-if ="!store.data.boards[0].name.startsWith('Duet')">
                            SPI Channel
                        </th>
                        <th v-if ="!store.data.boards[0].name.startsWith('Duet')">
                            SPI CS Port
                        </th>
                        <th v-if ="!store.data.boards[0].name.startsWith('Duet')">
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
                            <select-input title="Type of the connected accelerometer" :options="AccelerometerTypes"
                                          :required="false" :model-value="getAccelerometerModel(board)"
                                          @update:model-value="setAccelerometerModel(board, $event)" />
                        </td>
                        <td>
                            <select-input title="Orientation of the accelerometer board, see docs for further info (I parameter)"
                                          :options="OrientationOptions" :model-value="getAccelerometerOrientation(board)"
                                          @update:model-value="setAccelerometerOrientation(board, $event)" />
                        </td>
                        <td v-if ="store.data.boards[0].name.startsWith('Duet')">
                            <port-input :board="board.canAddress" :function="ConfigPortFunction.accelerometerSpiCs"
                                        :index="board.canAddress ?? 0" :disabled="getAccelerometerModel(board) === null"
                                        :required="!hasBuiltInAccelerometer(board)" />
                        </td>
                        <td v-if ="store.data.boards[0].name.startsWith('Duet')">
                            <port-input :board="board.canAddress" :function="ConfigPortFunction.accelerometerInt"
                                        :index="board.canAddress ?? 0" :disabled="getAccelerometerModel(board) === null"
                                        :required="!hasBuiltInAccelerometer(board)" />
                        </td>
                        <td v-if ="!store.data.boards[0].name.startsWith('Duet')" >
							<text-input label="spiChannel" title="This is the pin to be used in board.txt for 8266wifi.serialRxPin and is used to update the ESP from DWC" :max-length="8"
										v-model="spiChannel" :required="false" />
						</td>
                    </tr>
                </tbody>
            </table>

            <div v-else class="alert alert-info mb-0">
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
import type { StoreState } from "pinia";

const OrientationOptions: Array<SelectOption> = [
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

const AccelerometerTypes: Array<SelectOption> = [
    {
        text: "None",
        value: null
    },
    {
        text: "LIS3DH",
        value: "LIS3DH"
    }
];
</script>

<script setup lang="ts">
import { Accelerometer, type Board } from "@duet3d/objectmodel";
import { computed } from "vue";

import ConfigSection from "@/components/ConfigSection.vue";
import SelectInput from "@/components/inputs/SelectInput.vue";
import PortInput from "@/components/inputs/PortInput.vue";

import { useStore } from "@/store";
import { ConfigSectionType } from "@/store/sections";
import { getBoardDefinition } from "@/store/Boards";
import { getExpansionBoardDefinition, getExpansionBoardType } from "@/store/ExpansionBoards";
import { ConfigPortFunction } from "@/store/model/ConfigPort";

const store = useStore();

const accelerometerBoards = computed(() => {
    const result: Array<StoreState<Board>> = [];
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

const spiChannel = computed({
	get: () => {
		if (store.data.configTool.networkEspType === ConfigNetworkEspType.esp32) {
			return store.data.boardDefinition?.stm?.esp32.rxPin === null ? 'NoPin' : store.data.boardDefinition?.stm?.esp32.rxPin;
		} else if (store.data.configTool.networkEspType === ConfigNetworkEspType.esp8266) {
			return store.data.boardDefinition?.stm?.esp8266.rxPin === null ? 'NoPin' : store.data.boardDefinition?.stm?.esp8266.rxPin;
		}
	},
	set(value) {
		if (store.data.boardDefinition !== null && store.data.boardDefinition.stm !== null){
			const newValue = value.trim() === "" ? 'NoPin' : value.trim();
			if (store.data.configTool.networkEspType === ConfigNetworkEspType.esp32) {
				store.data.boardDefinition.stm.esp32.rxPin = newValue;
			} else if (store.data.configTool.networkEspType === ConfigNetworkEspType.esp8266) {
				store.data.boardDefinition.stm.esp8266.rxPin = newValue;
			}
		}
	}
});

function hasBuiltInAccelerometer(board: StoreState<Board>) {
    return board.canAddress && (getExpansionBoardDefinition(board as Board)?.hasBuiltInAccelerometer ?? false);
}

function getAccelerometerModel(board: StoreState<Board>) {
    return (board.accelerometer !== null) ? "LIS3DH" : null;
}

function setAccelerometerModel(board: StoreState<Board>, value: string | null) {
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

function getAccelerometerOrientation(board: StoreState<Board>) {
    return (board.accelerometer !== null) ? board.accelerometer.orientation : 20;
}

function setAccelerometerOrientation(board: StoreState<Board>, value: number) {
    if (board.accelerometer !== null) {
        board.accelerometer.orientation = value;
    }
}
</script>