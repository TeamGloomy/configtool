<template>
	<config-section id="network" board-txt :type="ConfigSectionType.Network" title="Network" url-title="Network Configuration"
					url="https://docs.duet3d.com/en/User_manual/Machine_configuration/Networking">
		<div class="row">
			<!-- Ethernet -->
			<div v-if="lanInterface" class="col-12">
				<check-input label="Configure Ethernet"
							 title="Check this option to configure a LAN connection over Ethernet" v-model="configureLan"
							 :preset="presetLanInterface?.state !== NetworkInterfaceState.disabled" />
				<div v-if="configureLan" class="row ms-3 mt-2">
					<div class="col-12">
						<check-input label="Acquire dynamic IP address via DHCP"
									 title="Check this option to use DHCP for automatic IPv4 configuration"
									 v-model="dhcpLan"
									 :preset="presetLanInterface?.configuredIP === null || presetLanInterface?.configuredIP === '0.0.0.0'" />
					</div>
					<template v-if="!dhcpLan">
						<div class="row ms-3 mt-2">
							<div class="col">
								<ip-input label="Static IP Address" title="Static IPv4 address"
										  :model-value="lanInterface.configuredIP ?? ''"
										  @update:model-value="lanInterface!.configuredIP = $event"
										  :preset="presetLanInterface?.configuredIP" />
							</div>
							<div class="col">
								<ip-input label="Subnet Mask" title="IPv4 subnet mask" net-mask
										  :model-value="lanInterface.subnet ?? ''"
										  @update:model-value="lanInterface!.subnet = $event"
										  :preset="presetLanInterface?.subnet" />
							</div>
							<div class="col">
								<ip-input label="Gateway" title="IPv4 gateway address"
										  :model-value="lanInterface.gateway ?? ''"
										  @update:model-value="lanInterface!.gateway = $event"
										  :preset="presetLanInterface?.gateway" />
							</div>
							<div class="col">
								<ip-input label="DNS Server" title="IPv4 DNS server address"
										  :disabled="store.data.sbc === null"
										  :model-value="store.data.sbc ? (lanInterface.dnsServer ?? '') : ''"
										  @update:model-value="lanInterface!.dnsServer = $event ? $event : null"
										  :preset="presetLanInterface?.dnsServer" :required="false" />
							</div>
						</div>
					</template>
				</div>
			</div>

			<!-- Spacer-->
			<div v-if="lanInterface && wifiInterface" class="mt-3"></div>

			<!-- WiFi -->
			<div v-if="wifiInterface" class="col-12">
				<check-input label="Configure WiFi" title="Check this option to configure a WiFi connection"
							 v-model="configureWifi"
							 :preset="presetWifiInterface?.state !== NetworkInterfaceState.disabled" />

				<div v-if="configureWifi" class="row ms-3 mt-2">
					<div class="col-12 mb-3">
						<div class="row">
							<div class="col-4">
								<text-input label="WiFi SSID" placeholder="optional"
											title="WiFi SSID to connect to" :max-length="32"
											v-model="store.data.configTool.wifi.ssid" :required="false" />
							</div>
							<div class="col-8">
								<text-input password label="WiFi Password" title="Optional PSK used for connecting to the specified WiFi"
											:max-length="64" v-model="store.data.configTool.wifi.psk" :required="false" />
							</div>
						</div>
					</div>
					<div class="col-12">
						<check-input label="Acquire dynamic IP address via DHCP"
									 title="Check this option to use DHCP for automatic IPv4 configuration"
									 v-model="dhcpWifi"
									 :preset="presetWifiInterface?.configuredIP === null || presetWifiInterface?.configuredIP === '0.0.0.0'" />
					</div>
					<template v-if="!dhcpWifi">
						<div class="row ms-3 mt-2">
							<div class="col">
								<ip-input label="Static IP Address" title="Static IPv4 address"
										  :model-value="wifiInterface.configuredIP ?? ''"
										  @update:model-value="wifiInterface!.configuredIP = $event"
										  :preset="presetWifiInterface?.configuredIP" />
							</div>
							<div class="col">
								<ip-input label="Subnet Mask" title="IPv4 subnet mask" net-mask
										  :model-value="wifiInterface.subnet ?? ''"
										  @update:model-value="wifiInterface!.subnet = $event"
										  :preset="presetWifiInterface?.subnet" />
							</div>
							<div class="col">
								<ip-input label="Gateway" title="IPv4 gateway address"
										  :model-value="wifiInterface.gateway ?? ''"
										  @update:model-value="wifiInterface!.gateway = $event"
										  :preset="presetWifiInterface?.gateway" />
							</div>
							<div class="col">
								<ip-input label="DNS Server" title="IPv4 DNS server address"
										  :disabled="store.data.sbc === null"
										  :model-value="store.data.sbc ? (wifiInterface.dnsServer ?? '') : ''"
										  @update:model-value="wifiInterface!.dnsServer = $event ? $event : null"
										  :preset="presetWifiInterface?.dnsServer" :required="false" />
							</div>
						</div>
					</template>
				</div>
			</div>
		</div>
		<div v-if="configureLan || configureWifi" class="row mt-3">
			<div class="col">
				<text-input password label="Machine Password" title="Required password for network access" :max-length="20"
							placeholder="reprap" v-model="store.data.configTool.password" :required="false" />
			</div>
			<div class="col d-flex flex-column justify-content-end">
				<check-input label="Enable HTTP" title="Enable HTTP access using Duet Web Control"
							 :model-value="isProtocolEnabled(NetworkProtocol.HTTP)"
							 @update:model-value="setProtocolEnabled(NetworkProtocol.HTTP, $event)"
							 :preset="isPresetProtocolEnabled(NetworkProtocol.HTTP)" />
				<check-input v-if="store.data.sbc !== null" label="Enable HTTPS"
							 title="Enable HTTPS access using Duet Web Control via self-signed certificate"
							 :model-value="isProtocolEnabled(NetworkProtocol.HTTPS)"
							 @update:model-value="setProtocolEnabled(NetworkProtocol.HTTPS, $event)"
							 :preset="isPresetProtocolEnabled(NetworkProtocol.HTTP)" />
			</div>
			<div class="col d-flex flex-column justify-content-end">
				<check-input label="Enable FTP" title="Enable FTP access"
							 :model-value="isProtocolEnabled(NetworkProtocol.FTP)"
							 @update:model-value="setProtocolEnabled(NetworkProtocol.FTP, $event)"
							 :preset="isPresetProtocolEnabled(NetworkProtocol.FTP)" />
				<check-input v-if="store.data.sbc !== null" label="Enable SFTP" title="Enable SFTP access"
							 :model-value="isProtocolEnabled(NetworkProtocol.SFTP)"
							 @update:model-value="setProtocolEnabled(NetworkProtocol.SFTP, $event)"
							 :preset="isPresetProtocolEnabled(NetworkProtocol.SFTP)" />
			</div>
			<div class="col d-flex flex-column justify-content-end">
				<check-input v-if="!isSTM32Board" label="Enable Telnet" title="Enable Telnet access using Duet Web Control"
							 :model-value="isProtocolEnabled(NetworkProtocol.Telnet)"
							 @update:model-value="setProtocolEnabled(NetworkProtocol.Telnet, $event)"
							 :preset="isPresetProtocolEnabled(NetworkProtocol.Telnet)" />
				<check-input v-if="store.data.sbc !== null" label="Enable SSH" title="Enable SSH access"
							 :model-value="isProtocolEnabled(NetworkProtocol.SSH)"
							 @update:model-value="setProtocolEnabled(NetworkProtocol.SSH, $event)"
							 :preset="isPresetProtocolEnabled(NetworkProtocol.SSH)" />
			</div>
		</div>
		<!-- WiFi module type — shown for all STM32 WiFi boards (slot is fixed but module can be swapped).
			 Hidden in SBC mode, where networking is handled by the SBC and no WiFi module is needed. -->
		<div v-if="stm32WifiDef && wifiInterface && store.data.sbc === null" class="row mt-3">
			<div class="col-auto">
				<select-input label="WiFi Module Type"
							  title="Select the WiFi module type installed in this board's WiFi slot"
							  :options="wifiModuleTypeOptions"
							  v-model="store.data.configTool.stm32WifiModuleType"
							  :preset="stm32WifiDef.moduleType" />
			</div>
		</div>
		<!-- ESP32 pin overrides — only for non-dedicated boards where the module may be wired differently -->
		<div v-if="stm32WifiDef && wifiInterface && !stm32WifiDef.dedicated && store.data.sbc === null" class="row mt-3">
			<div class="col-12 mb-1">
				<strong>ESP32 Module Pins</strong>
				<span class="text-muted small ms-2">
					Override board defaults only if you have a non-standard wiring. Changes are written to board.txt.
				</span>
			</div>
			<div class="col-auto">
				<text-input label="espDataReadyPin"
							title="GPIO on the STM32 that the ESP32 asserts when it has data to send"
							v-model="store.data.configTool.stm32WifiEspDataReadyPin"
							:preset="stm32WifiDef.espDataReadyPin" :max-length="8" />
			</div>
			<div class="col-auto">
				<text-input label="TfrReadyPin"
							title="GPIO used for transfer-ready handshaking between STM32 and ESP32"
							v-model="store.data.configTool.stm32WifiTfrReadyPin"
							:preset="stm32WifiDef.tfrReadyPin" :max-length="8" />
			</div>
			<div class="col-auto">
				<text-input label="espResetPin"
							title="GPIO used to hardware-reset the ESP32"
							v-model="store.data.configTool.stm32WifiEspResetPin"
							:preset="stm32WifiDef.espResetPin" :max-length="8" />
			</div>
			<div class="col-auto">
				<text-input label="Serial RX pin"
							title="STM32 UART RX pin connected to the ESP32 TX"
							v-model="store.data.configTool.stm32WifiSerialRxPin"
							:preset="stm32WifiDef.serialRxPin" :max-length="8" />
			</div>
			<div class="col-auto">
				<text-input label="Serial TX pin"
							title="STM32 UART TX pin connected to the ESP32 RX"
							v-model="store.data.configTool.stm32WifiSerialTxPin"
							:preset="stm32WifiDef.serialTxPin" :max-length="8" />
			</div>
		</div>
	</config-section>
</template>

<script setup lang="ts">
import { NetworkInterfaceState, NetworkInterfaceType, NetworkProtocol } from "@duet3d/objectmodel";
import { computed } from "vue";

import ConfigSection from "@/components/ConfigSection.vue";
import CheckInput from "@/components/inputs/CheckInput.vue";
import SelectInput from "@/components/inputs/SelectInput.vue";
import TextInput from "@/components/inputs/TextInput.vue";
import IpInput from "@/components/inputs/IpInput.vue";

import { useStore } from "@/store";
import { isSTM32BoardType, type STM32BoardDescriptor } from "@/store/STM32Boards";
import { ConfigSectionType } from "@/store/sections";

const store = useStore();

const wifiModuleTypeOptions = [
	{ text: "esp32",    value: "esp32"    },
	{ text: "esp32eth", value: "esp32eth" },
];

// STM32 WiFi board detection
const stm32WifiDef = computed(() => {
	const bt = store.data.boardType;
	if (bt !== null && isSTM32BoardType(bt)) {
		return (store.data.boardDefinition as STM32BoardDescriptor | null)?.wifiConfig ?? null;
	}
	return null;
});
const isSTM32Board = computed(() => {
	const bt = store.data.boardType;
	return bt !== null && isSTM32BoardType(bt);
});

// Ethernet
const lanInterface = computed(() => store.data.network.interfaces.find(iface => iface.type === NetworkInterfaceType.ethernet));
const presetLanInterface = computed(() => store.preset.network.interfaces.find(iface => iface.type === NetworkInterfaceType.ethernet));

const configureLan = computed({
	get() { return !!lanInterface.value && (lanInterface.value.state !== NetworkInterfaceState.disabled); },
	set(value) {
		if (lanInterface.value) {
			lanInterface.value.state = value ? NetworkInterfaceState.active : NetworkInterfaceState.disabled;
		}
	}
});

const dhcpLan = computed({
	get() { return !!lanInterface.value && (lanInterface.value.configuredIP === null || lanInterface.value.configuredIP === "0.0.0.0") },
	set(value) {
		if (lanInterface.value) {
			lanInterface.value.configuredIP = value ? "0.0.0.0" : (lanInterface.value.actualIP ?? "");
		}
	}
});

// WiFi
const wifiInterface = computed(() => store.data.network.interfaces.find(iface => iface.type === NetworkInterfaceType.wifi));
const presetWifiInterface = computed(() => store.preset.network.interfaces.find(iface => iface.type === NetworkInterfaceType.wifi));

const configureWifi = computed({
	get() { return !!wifiInterface.value && (wifiInterface.value.state !== NetworkInterfaceState.disabled); },
	set(value) {
		if (wifiInterface.value) {
			wifiInterface.value.state = value ? NetworkInterfaceState.active : NetworkInterfaceState.disabled;
		}
	}
});

const dhcpWifi = computed({
	get() { return !!wifiInterface.value && (wifiInterface.value.configuredIP === null || wifiInterface.value.configuredIP === "0.0.0.0") },
	set(value) {
		if (wifiInterface.value) {
			wifiInterface.value.configuredIP = value ? "0.0.0.0" : (wifiInterface.value.actualIP ?? "");
		}
	}
});

// Protocols
function isProtocolEnabled(protocol: NetworkProtocol) {
	for (const iface of store.data.network.interfaces) {
		if (iface.activeProtocols.has(protocol)) {
			return true;
		}
	}
	return false;
}

function isPresetProtocolEnabled(protocol: NetworkProtocol) {
	for (const iface of store.data.network.interfaces) {
		if (iface.activeProtocols.has(protocol)) {
			return true;
		}
	}
	return false;
}

function setProtocolEnabled(protocol: NetworkProtocol, enabled: boolean) {
	for (const iface of store.data.network.interfaces) {
		if (enabled) {
			iface.activeProtocols.add(protocol);
		} else {
			iface.activeProtocols.delete(protocol);
		}
	}
}
</script>
