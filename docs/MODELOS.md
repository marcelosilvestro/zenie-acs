# Modelos e caminhos TR-069

> Gerado por `scripts/compare_samples.py` a partir de `samples/*.anon.json`. Não edite à mão.

## Inventário

| Modelo | Firmware | Hardware | Tipo | WAN | Wi-Fi | Parâmetros | Sample |
|---|---|---|---|---|---|---|---|
| EC230-G1 | 2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | EC230-G1 v1 00000001 | Roteador | Ethernet | 4 (n) | 403 | [EC230-G1_2.0.0-0.9-v6034.0-Build-200805-Rel.39961n.anon.json](../samples/EC230-G1_2.0.0-0.9-v6034.0-Build-200805-Rel.39961n.anon.json) |
| F6201B | V9.3.10P7N9 | V9.3.12 | ONU GPON | GPON | 6 (ax) | 3176 | [F6201B_V9.3.10P7N9.anon.json](../samples/F6201B_V9.3.10P7N9.anon.json) |
| F6600P | V9.0.10P6N40 | V9.0.12 | ONU GPON | GPON | 6 (ax) | 3627 | [F6600P_V9.0.10P6N40.anon.json](../samples/F6600P_V9.0.10P6N40.anon.json) |
| F670L | V1.1.20P3N12 | V1.1.01 | ONU GPON | GPON | 5 (ac) | 1542 | [F670L_V1.1.20P3N12.anon.json](../samples/F670L_V1.1.20P3N12.anon.json) |
| F670L | V9.0.11P3N10 | V9.0 | ONU GPON | PON | 5 (ac) | 2242 | [F670L_V9.0.11P3N10.anon.json](../samples/F670L_V9.0.11P3N10.anon.json) |
| H196A V9 | V9.0.0P7_MUL | V9.0.0 | Roteador | Ethernet | 5 (ac) | 2497 | [H196A-V9_V9.0.0P7_MUL.anon.json](../samples/H196A-V9_V9.0.0P7_MUL.anon.json) |
| H198A V3.0 | V3.0.0C6_MUL | V3.0.1 | Roteador | Ethernet | 5 (ac) | 1589 | [ZXHN-H198A-V3.0_V3.0.0C6_MUL.anon.json](../samples/ZXHN-H198A-V3.0_V3.0.0C6_MUL.anon.json) |
| H199A | V9.1.0P12_MUL | V9.1.1 | Roteador | Ethernet | 5 (ac) | 2535 | [ZXHN-H199A_V9.1.0P12_MUL.anon.json](../samples/ZXHN-H199A_V9.1.0P12_MUL.anon.json) |
| H3601P | V9.0.0P10_MUL | V9.0.2 | Roteador | Ethernet | 6 (ax) | 2671 | [ZXHN-H3601P_V9.0.0P10_MUL.anon.json](../samples/ZXHN-H3601P_V9.0.0P10_MUL.anon.json) |

## Rádios Wi-Fi por modelo

Faixa deduzida de `X_ZTE-COM_OperatingFrequencyBand`/`X_ZTE-COM_RFBand` ou, na falta, de `Standard`.

- **EC230-G1** (2 SSIDs; `*` = habilitado; faixa via Standard): 1=2.4*, 3=5*
- **F6201B** (8 SSIDs; `*` = habilitado; faixa via X_ZTE-COM_OperatingFrequencyBand): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5
- **F6600P** (8 SSIDs; `*` = habilitado; faixa via X_ZTE-COM_OperatingFrequencyBand): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5
- **F670L** (8 SSIDs; `*` = habilitado; faixa via X_ZTE-COM_OperatingFrequencyBand): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5*
- **F670L** (8 SSIDs; `*` = habilitado; faixa via X_ZTE-COM_OperatingFrequencyBand): 1=2.4*, 2=2.4*, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5*
- **H196A V9** (8 SSIDs; `*` = habilitado; faixa via Standard): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5
- **H198A V3.0** (8 SSIDs; `*` = habilitado; faixa via Standard): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5
- **H199A** (8 SSIDs; `*` = habilitado; faixa via X_ZTE-COM_OperatingFrequencyBand): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5
- **H3601P** (8 SSIDs; `*` = habilitado; faixa via X_ZTE-COM_OperatingFrequencyBand): 1=2.4*, 2=2.4, 3=2.4, 4=2.4, 5=5*, 6=5, 7=5, 8=5

## Equipamento

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| Modelo | 1. `DeviceInfo.ModelName` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Firmware | 1. `DeviceInfo.SoftwareVersion` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Hardware | 1. `DeviceInfo.HardwareVersion` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Uptime | 1. `DeviceInfo.UpTime` | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) |
| Serial GPON | 1. `DeviceInfo.X_ZTE-COM_GPONSN` | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | — | — | — | — |
| Tipo de acesso WAN | 1. `WANDevice.{i}.WANCommonInterfaceConfig.WANAccessType` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| EasyMesh | 1. `X_ZTE-COM_EasyMesh.Enable` | — | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) |

## Óptico (PON)

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| RX | 1. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.RXPower`<br>2. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.OpticalTransceiver.RXPower` | — | 1 (string), 2 (int) | 1 (string), 2 (int) | 1 (int) | 1 (string) | — | — | — | — |
| TX | 1. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.TXPower`<br>2. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.OpticalTransceiver.TXPower` | — | 1 (string), 2 (int) | 1 (string), 2 (int) | 1 (int) | 1 (string) | — | — | — | — |
| Temperatura | 1. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.TransceiverTemperature`<br>2. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.OpticalTransceiver.Temperature` | — | 1 (string), 2 (int) | 1 (string), 2 (int) | 1 (int) | 1 (string) | — | — | — | — |
| Tensão | 1. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.SupplyVoltage`<br>2. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.OpticalTransceiver.Vcc` | — | 1 (string), 2 (unsignedInt) | 1 (string), 2 (unsignedInt) | 1 (int) | 1 (string) | — | — | — | — |
| Corrente laser | 1. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.BiasCurrent`<br>2. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.OpticalTransceiver.TXBias` | — | 1 (string), 2 (unsignedInt) | 1 (string), 2 (unsignedInt) | 1 (int) | 1 (string) | — | — | — | — |
| Status PON | 1. `WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig.Status` | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | — | — | — | — |

## WAN

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| Status | 1. `WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}.ConnectionStatus`<br>2. `WANDevice.{i}.WANConnectionDevice.{i}.WANIPConnection.{i}.ConnectionStatus` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| IP | 1. `WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}.ExternalIPAddress`<br>2. `WANDevice.{i}.WANConnectionDevice.{i}.WANIPConnection.{i}.ExternalIPAddress` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Usuário PPPoE | 1. `WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}.Username` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Lista de serviço | 1. `WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}.X_ZTE-COM_ServiceList`<br>2. `WANDevice.{i}.WANConnectionDevice.{i}.WANIPConnection.{i}.X_ZTE-COM_ServiceList` | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| VLAN | 1. `WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}.X_ZTE-COM_VLANID`<br>2. `WANDevice.{i}.WANConnectionDevice.{i}.WANIPConnection.{i}.X_ZTE-COM_VLANID` | — | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) |
| Uptime WAN | 1. `WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}.Uptime`<br>2. `WANDevice.{i}.WANConnectionDevice.{i}.WANIPConnection.{i}.Uptime` | — | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) |

## Wi-Fi (geral)

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| Bandsteering (2.4+5 unificados) | 1. `X_ZTE-COM_Bandsteering.Enable`<br>2. `WIFI.BANDSTEER.BandSteeringEnable`<br>3. `X_ZTE-COM_BandSteering.Enable` | — | 1 (boolean), 2 (boolean) | 1 (boolean), 2 (boolean) | 1 (boolean) | 1 (boolean), 2 (boolean) | 3 (unsignedInt) | — | 3 (unsignedInt) | 3 (unsignedInt) |
| Wi-Fi 6: WPA3 | 1. `WLANConfiguration.{i}.WPA3AuthenticationMode` | — | 1 (string) | 1 (string) | — | — | — | — | — | — |
| Wi-Fi 6: OFDMA | 1. `WLANConfiguration.{i}.X_ZTE-COM_DownLinkOFDMAEnable` | — | 1 (boolean) | 1 (boolean) | — | — | — | — | — | — |
| Wi-Fi 6: TWT | 1. `WLANConfiguration.{i}.X_ZTE-COM_TWTSupport` | — | 1 (boolean) | 1 (boolean) | — | — | — | — | — | — |

## Wi-Fi (rádio/SSID)

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| Faixa (2.4/5) | 1. `WLANConfiguration.{i}.X_ZTE-COM_OperatingFrequencyBand`<br>2. `WLANConfiguration.{i}.X_ZTE-COM_RFBand`<br>3. `WLANConfiguration.{i}.Standard` | 3 (string) | 1 (string), 3 (string) | 1 (string), 3 (string) | 1 (string), 2 (string), 3 (string) | 1 (string), 3 (string) | 3 (string) | 3 (string) | 1 (string), 3 (string) | 1 (string), 3 (string) |
| Padrão (ax = Wi-Fi 6) | 1. `WLANConfiguration.{i}.Standard` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Rádio ligado | 1. `WLANConfiguration.{i}.RadioEnabled` | — | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) |
| SSID | 1. `WLANConfiguration.{i}.SSID` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Senha (escrita) | 1. `WLANConfiguration.{i}.KeyPassphrase`<br>2. `WLANConfiguration.{i}.PreSharedKey.{i}.KeyPassphrase` | 1 (string), 2 (string) | 1 (string), 2 (string) | 1 (string), 2 (string) | 2 (string) | 1 (string), 2 (string) | 1 (string), 2 (string) | 1 (string), 2 (string) | 1 (string), 2 (string) | 1 (string), 2 (string) |
| Canal | 1. `WLANConfiguration.{i}.Channel` | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) |
| Canal automático | 1. `WLANConfiguration.{i}.AutoChannelEnable` | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) |
| Largura configurada | 1. `WLANConfiguration.{i}.BandWidth`<br>2. `WLANConfiguration.{i}.X_ZTE-COM_BandWidth` | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 2 (string) | 2 (string) | 2 (string) | 2 (string) |
| Largura em operação | 1. `WLANConfiguration.{i}.X_ZTE-COM_OperatingChannelBandwidth` | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | — | — | — | — |
| Status | 1. `WLANConfiguration.{i}.Status` | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Nº clientes | 1. `WLANConfiguration.{i}.TotalAssociations` | — | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) | 1 (unsignedInt) |

## Wi-Fi (cliente associado)

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| MAC | 1. `WLANConfiguration.{i}.AssociatedDevice.{i}.AssociatedDeviceMACAddress`<br>2. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_MACAddress` | — | — | 1 (string), 2 (string) | 1 (string), 2 (string) | 1 (string), 2 (string) | 1 (string) | — | 1 (string) | 1 (string) |
| IP | 1. `WLANConfiguration.{i}.AssociatedDevice.{i}.AssociatedDeviceIPAddress` | — | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | — | 1 (string) | 1 (string) |
| Nome | 1. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_AssociatedDeviceName`<br>2. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_DeviceName` | — | — | 1 (string) | 1 (string), 2 (string) | 1 (string) | 1 (string) | — | 1 (string) | 1 (string) |
| RSSI | 1. `WLANConfiguration.{i}.AssociatedDevice.{i}.AssociatedDeviceRssi`<br>2. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_RSSI`<br>3. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_Rssi`<br>4. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_WLAN_RSSI`<br>5. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_SignalStrength`<br>6. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_SigalStrength` | — | — | 1 (int), 2 (int), 4 (int), 5 (int) | 1 (int), 2 (int), 6 (int) | 1 (int), 3 (int), 4 (int), 5 (int) | 2 (int) | — | 2 (int) | 2 (int) |
| Taxa | 1. `WLANConfiguration.{i}.AssociatedDevice.{i}.LastDataTransmitRate`<br>2. `WLANConfiguration.{i}.AssociatedDevice.{i}.AssociatedDeviceRate` | — | — | 1 (unsignedInt), 2 (unsignedInt) | 1 (unsignedInt), 2 (unsignedInt) | 1 (unsignedInt), 2 (unsignedInt) | 1 (string), 2 (unsignedInt) | — | 1 (string), 2 (unsignedInt) | 1 (string), 2 (unsignedInt) |
| Tempo conectado | 1. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_StayTime`<br>2. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_UpTime`<br>3. `WLANConfiguration.{i}.AssociatedDevice.{i}.X_ZTE-COM_Uptime` | — | — | 1 (string), 3 (unsignedInt) | 1 (unsignedInt), 2 (unsignedInt) | 1 (string) | 1 (unsignedInt), 2 (unsignedInt) | — | 1 (unsignedInt), 2 (unsignedInt) | 1 (unsignedInt), 2 (unsignedInt) |

## DHCP / hosts LAN

Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.

| Informação | Candidatos | EC230-G1<br>2.0.0 0.9 v6034.0 Build 200805 Rel.39961n | F6201B<br>V9.3.10P7N9 | F6600P<br>V9.0.10P6N40 | F670L<br>V1.1.20P3N12 | F670L<br>V9.0.11P3N10 | H196A V9<br>V9.0.0P7_MUL | H198A V3.0<br>V3.0.0C6_MUL | H199A<br>V9.1.0P12_MUL | H3601P<br>V9.0.0P10_MUL |
|---|---|---|---|---|---|---|---|---|---|---|
| Hostname | 1. `Hosts.Host.{i}.HostName` | 1 (string) | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| IP | 1. `Hosts.Host.{i}.IPAddress` | 1 (string) | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| MAC | 1. `Hosts.Host.{i}.MACAddress` | 1 (string) | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Interface (Wi-Fi/cabo) | 1. `Hosts.Host.{i}.InterfaceType` | 1 (string) | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Ativo | 1. `Hosts.Host.{i}.Active` | 1 (boolean) | — | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) | 1 (boolean) |
| Origem (DHCP/estático) | 1. `Hosts.Host.{i}.AddressSource` | 1 (string) | — | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) | 1 (string) |
| Lease restante | 1. `Hosts.Host.{i}.LeaseTimeRemaining` | 1 (int) | — | 1 (int) | 1 (int) | 1 (int) | 1 (int) | 1 (int) | 1 (int) | 1 (int) |
