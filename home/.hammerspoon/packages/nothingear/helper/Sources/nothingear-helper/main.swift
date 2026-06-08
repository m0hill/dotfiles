@preconcurrency import CoreBluetooth
import Darwin
import Foundation

private let helperMarkerBase64 = "__NOTHINGEAR_JSON_B64__"
nonisolated(unsafe) private var responseOutputPath: String?

private let serviceUUID = CBUUID(string: "0000FD90-0000-1000-8000-00805F9B34FB")
private let shortServiceUUID = CBUUID(string: "FD90")
private let notifyUUID = CBUUID(string: "CA235943-1810-45E6-8326-FC8CA3BC45CE")
private let writeUUID = CBUUID(string: "68745353-1810-4B13-83A2-C1B21B652C9B")

private let noiseModes: [String: UInt8] = [
	"anc": 1, "strong": 1, "anc_strong": 1,
	"medium": 2, "anc_medium": 2,
	"weak": 3, "anc_weak": 3,
	"smart": 4, "smart1": 4,
	"off": 5,
	"comfortable": 6,
	"transparency": 7, "transparent": 7, "trans": 7, "passthrough": 7, "pass_through": 7,
	"smart2": 8,
]

private let noiseModeNames: [Int: String] = [
	1: "ANC strong",
	2: "ANC medium",
	3: "ANC weak",
	4: "Smart ANC",
	5: "Off",
	6: "Comfortable",
	7: "Transparency",
	8: "Smart ANC 2",
]

private let eqModes: [String: UInt8] = [
	"balanced": 0, "flat": 0,
	"voice": 1,
	"treble": 2, "more_treble": 2,
	"bass": 3, "more_bass": 3,
	"dirac": 4, "dirac_eq": 4,
	"custom": 5, "simple_custom": 5,
]

private let eqModeNames: [Int: String] = [
	0: "Balanced",
	1: "More voice",
	2: "More treble",
	3: "More bass",
	4: "Dirac EQ",
	5: "Custom",
]

private let batteryNames: [Int: String] = [
	1: "watch",
	2: "left",
	3: "right",
	4: "case",
	5: "tws",
	6: "stereo",
]

struct BatteryLevel: Encodable {
	let id: Int
	let name: String
	let level: Int
	let charging: Bool
}

struct HelperResponse: Encodable {
	var ok: Bool
	var helperReady: Bool
	var deviceFound: Bool
	var command: String
	var message: String?
	var error: String?
	var deviceName: String?
	var deviceIdentifier: String?
	var txHex: String?
	var rxHex: String?
	var requestCommand: String?
	var responseCommand: String?
	var control: String?
	var fsn: Int?
	var payloadHex: String?
	var crcOk: Bool?
	var events: [String]
	var ancMode: Int?
	var ancModeName: String?
	var eqMode: Int?
	var eqModeName: String?
	var battery: [BatteryLevel]?
	var protocolVersion: String?
}

struct PacketFrame {
	let raw: Data
	let control: UInt16
	let command: UInt16
	let length: Int
	let fsn: UInt8
	let payload: Data
	let crcOk: Bool?

	var requestCommand: UInt16 { command | 0x8000 }
}

struct Request {
	let name: String
	let packet: Data?
	let expectedResponseCommand: UInt16?
	let message: String
	let timeout: TimeInterval
}

enum HelperError: LocalizedError {
	case invalidCommand
	case invalidMode(String)
	case missingArgument(String)

	var errorDescription: String? {
		switch self {
		case .invalidCommand:
			return "Usage: nothingear-helper status | anc-query | anc-set MODE | battery | protocol | eq-query | eq-set MODE | bass-query | bass-set on|off LEVEL | spatial-query | spatial-set on|off [headOn|headOff] | raw CMD [PAYLOAD_HEX]"
		case let .invalidMode(value):
			return "Unknown mode: \(value)"
		case let .missingArgument(value):
			return "Missing argument: \(value)"
		}
	}
}

private func hex(_ data: Data) -> String {
	data.map { String(format: "%02x", $0) }.joined(separator: " ")
}

private func hexCommand(_ command: UInt16) -> String {
	String(format: "0x%04x", command)
}

private func crc16(_ bytes: [UInt8]) -> UInt16 {
	var crc: UInt16 = 0xffff
	for byte in bytes {
		crc ^= UInt16(byte)
		for _ in 0..<8 {
			if (crc & 1) != 0 {
				crc = (crc >> 1) ^ 0xa001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

private func packet(command: UInt16, payload: [UInt8] = [], fsn: UInt8 = 1, deviceType: UInt16 = 1) -> Data {
	let control: UInt16 = (deviceType << 8) | 0x60
	var bytes: [UInt8] = [0x55]
	bytes += [UInt8(control & 0xff), UInt8(control >> 8)]
	bytes += [UInt8(command & 0xff), UInt8(command >> 8)]
	let length = UInt16(payload.count)
	bytes += [UInt8(length & 0xff), UInt8(length >> 8), fsn]
	bytes += payload
	let crc = crc16(bytes)
	bytes += [UInt8(crc & 0xff), UInt8(crc >> 8)]
	return Data(bytes)
}

private func parseFrame(_ data: Data) -> PacketFrame? {
	let bytes = Array(data)
	guard bytes.count >= 8, bytes[0] == 0x55 else { return nil }
	let control = UInt16(bytes[1]) | (UInt16(bytes[2]) << 8)
	let command = UInt16(bytes[3]) | (UInt16(bytes[4]) << 8)
	let length = Int(UInt16(bytes[5]) | (UInt16(bytes[6]) << 8))
	let payloadStart = 8
	let payloadEnd = payloadStart + length
	guard bytes.count >= payloadEnd else { return nil }
	let payload = length > 0 ? Data(bytes[payloadStart..<payloadEnd]) : Data()
	let crcOk: Bool?
	if bytes.count >= payloadEnd + 2 {
		let received = UInt16(bytes[payloadEnd]) | (UInt16(bytes[payloadEnd + 1]) << 8)
		let calculated = crc16(Array(bytes[0..<payloadEnd]))
		crcOk = received == calculated
	} else {
		crcOk = nil
	}
	return PacketFrame(raw: data, control: control, command: command, length: length, fsn: bytes[7], payload: payload, crcOk: crcOk)
}

private func parseBoolean(_ value: String) -> UInt8? {
	switch value.lowercased() {
	case "1", "true", "on", "yes": return 1
	case "0", "false", "off", "no": return 0
	default: return nil
	}
}

private func parseUInt16(_ value: String) -> UInt16? {
	let normalized = value.lowercased()
	if normalized.hasPrefix("0x") {
		return UInt16(String(normalized.dropFirst(2)), radix: 16)
	}
	return UInt16(normalized, radix: 16) ?? UInt16(normalized)
}

private func parseHexPayload(_ values: ArraySlice<String>) -> [UInt8]? {
	let joined = values.joined(separator: " ")
		.replacingOccurrences(of: "0x", with: "")
		.replacingOccurrences(of: ",", with: " ")
	let compact = joined.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).joined()
	guard compact.count % 2 == 0 else { return nil }
	var result: [UInt8] = []
	var index = compact.startIndex
	while index < compact.endIndex {
		let next = compact.index(index, offsetBy: 2)
		guard let byte = UInt8(compact[index..<next], radix: 16) else { return nil }
		result.append(byte)
		index = next
	}
	return result
}

private func extractOutputPath(arguments: [String]) throws -> [String] {
	var result: [String] = []
	var index = 0
	while index < arguments.count {
		if arguments[index] == "--output" {
			let valueIndex = index + 1
			guard valueIndex < arguments.count else { throw HelperError.missingArgument("--output PATH") }
			responseOutputPath = arguments[valueIndex]
			index += 2
		} else {
			result.append(arguments[index])
			index += 1
		}
	}
	return result
}

private func parseRequest(arguments rawArguments: [String]) throws -> Request {
	let arguments = try extractOutputPath(arguments: rawArguments)
	let command = arguments.first ?? "status"
	let timeout: TimeInterval = 8

	switch command {
	case "status":
		return Request(name: command, packet: nil, expectedResponseCommand: nil, message: "Ready", timeout: 6)
	case "protocol":
		let commandId: UInt16 = 0xC001
		return Request(name: command, packet: packet(command: commandId), expectedResponseCommand: commandId & 0x7fff, message: "Protocol version", timeout: timeout)
	case "battery":
		let commandId: UInt16 = 0xC007
		return Request(name: command, packet: packet(command: commandId), expectedResponseCommand: commandId & 0x7fff, message: "Battery", timeout: timeout)
	case "anc-query":
		let commandId: UInt16 = 0xC01E
		return Request(name: command, packet: packet(command: commandId, payload: [0x03]), expectedResponseCommand: commandId & 0x7fff, message: "ANC state", timeout: timeout)
	case "anc-set":
		guard arguments.count >= 2 else { throw HelperError.missingArgument("MODE") }
		let modeArg = arguments[1].lowercased()
		let mode = noiseModes[modeArg] ?? UInt8(modeArg)
		guard let mode else { throw HelperError.invalidMode(arguments[1]) }
		let commandId: UInt16 = 0xF00F
		return Request(name: command, packet: packet(command: commandId, payload: [0x01, mode, 0x00]), expectedResponseCommand: commandId & 0x7fff, message: "ANC set to \(noiseModeNames[Int(mode)] ?? String(mode))", timeout: timeout)
	case "eq-query":
		let commandId: UInt16 = 0xC01F
		return Request(name: command, packet: packet(command: commandId), expectedResponseCommand: commandId & 0x7fff, message: "EQ mode", timeout: timeout)
	case "eq-set":
		guard arguments.count >= 2 else { throw HelperError.missingArgument("MODE") }
		let modeArg = arguments[1].lowercased()
		let mode = eqModes[modeArg] ?? UInt8(modeArg)
		guard let mode else { throw HelperError.invalidMode(arguments[1]) }
		let commandId: UInt16 = 0xF010
		return Request(name: command, packet: packet(command: commandId, payload: [mode]), expectedResponseCommand: commandId & 0x7fff, message: "EQ set to \(eqModeNames[Int(mode)] ?? String(mode))", timeout: timeout)
	case "bass-query":
		let commandId: UInt16 = 0xC04E
		return Request(name: command, packet: packet(command: commandId), expectedResponseCommand: commandId & 0x7fff, message: "Bass boost", timeout: timeout)
	case "bass-set":
		guard arguments.count >= 3 else { throw HelperError.missingArgument("on|off LEVEL") }
		guard let enabled = parseBoolean(arguments[1]), let level = UInt8(arguments[2]) else { throw HelperError.invalidMode(arguments.dropFirst().joined(separator: " ")) }
		let commandId: UInt16 = 0xF051
		return Request(name: command, packet: packet(command: commandId, payload: [enabled, level]), expectedResponseCommand: commandId & 0x7fff, message: "Bass boost \(enabled == 1 ? "on" : "off") level \(level)", timeout: timeout)
	case "spatial-query":
		let commandId: UInt16 = 0xC04F
		return Request(name: command, packet: packet(command: commandId), expectedResponseCommand: commandId & 0x7fff, message: "Spatial audio", timeout: timeout)
	case "spatial-set":
		guard arguments.count >= 2, let enabled = parseBoolean(arguments[1]) else { throw HelperError.missingArgument("on|off") }
		var payload = [enabled]
		if arguments.count >= 3 {
			guard let headTracking = parseBoolean(arguments[2]) else { throw HelperError.invalidMode(arguments[2]) }
			payload.append(headTracking)
		}
		let commandId: UInt16 = 0xF052
		return Request(name: command, packet: packet(command: commandId, payload: payload), expectedResponseCommand: commandId & 0x7fff, message: "Spatial audio \(enabled == 1 ? "on" : "off")", timeout: timeout)
	case "raw":
		guard arguments.count >= 2, let commandId = parseUInt16(arguments[1]) else { throw HelperError.missingArgument("CMD") }
		guard let payload = parseHexPayload(arguments.dropFirst(2)) else { throw HelperError.invalidMode("payload") }
		return Request(name: command, packet: packet(command: commandId, payload: payload), expectedResponseCommand: commandId & 0x7fff, message: "Raw \(hexCommand(commandId))", timeout: timeout)
	default:
		throw HelperError.invalidCommand
	}
}

private func baseResponse(for request: Request, ok: Bool) -> HelperResponse {
	HelperResponse(
		ok: ok,
		helperReady: false,
		deviceFound: false,
		command: request.name,
		message: nil,
		error: nil,
		deviceName: nil,
		deviceIdentifier: nil,
		txHex: request.packet.map(hex),
		rxHex: nil,
		requestCommand: nil,
		responseCommand: nil,
		control: nil,
		fsn: nil,
		payloadHex: nil,
		crcOk: nil,
		events: [],
		ancMode: nil,
		ancModeName: nil,
		eqMode: nil,
		eqModeName: nil,
		battery: nil,
		protocolVersion: nil
	)
}

private func enrich(_ response: inout HelperResponse, with frame: PacketFrame, request: Request) {
	response.helperReady = true
	response.rxHex = hex(frame.raw)
	response.requestCommand = hexCommand(frame.requestCommand)
	response.responseCommand = hexCommand(frame.command)
	response.control = hexCommand(frame.control)
	response.fsn = Int(frame.fsn)
	response.payloadHex = hex(frame.payload)
	response.crcOk = frame.crcOk

	let payload = Array(frame.payload)
	switch request.name {
	case "protocol":
		response.protocolVersion = String(data: frame.payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
		response.message = response.protocolVersion.map { "Protocol \($0)" } ?? request.message
	case "battery":
		if let first = payload.first {
			let count = Int(first)
			var levels: [BatteryLevel] = []
			for index in 0..<count {
				let start = 1 + (index * 2)
				guard payload.count > start + 1 else { break }
				let id = Int(payload[start])
				let raw = Int(payload[start + 1])
				levels.append(BatteryLevel(id: id, name: batteryNames[id] ?? "device\(id)", level: raw & 0x7f, charging: (raw & 0x80) != 0))
			}
			response.battery = levels
			response.message = levels.map { "\($0.name) \($0.level)%" }.joined(separator: ", ")
		}
	case "anc-query":
		if payload.count >= 2 {
			let mode = Int(payload[1])
			response.ancMode = mode
			response.ancModeName = noiseModeNames[mode] ?? "Mode \(mode)"
			response.message = "ANC: \(response.ancModeName!)"
		}
	case "eq-query":
		if let modeByte = payload.first {
			let mode = Int(modeByte)
			response.eqMode = mode
			response.eqModeName = eqModeNames[mode] ?? "Mode \(mode)"
			response.message = "EQ: \(response.eqModeName!)"
		}
	case "bass-query":
		if payload.count >= 2 {
			response.message = "Bass boost: \(payload[0] == 0 ? "off" : "on"), level \(payload[1])"
		}
	case "spatial-query":
		if let enabled = payload.first {
			if payload.count >= 2 {
				response.message = "Spatial: \(enabled == 0 ? "off" : "on"), head tracking \(payload[1] == 0 ? "off" : "on")"
			} else {
				response.message = "Spatial: \(enabled == 0 ? "off" : "on")"
			}
		}
	default:
		if request.name.hasSuffix("-set"), let ack = payload.first {
			response.ok = ack == 0
			response.message = ack == 0 ? request.message : "Device rejected command with code \(ack)"
			if ack != 0 { response.error = response.message }
		} else {
			response.message = request.message
		}
	}

	if response.message == nil {
		response.message = request.message
	}
}

private func emit(_ response: HelperResponse) -> Never {
	do {
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
		let data = try encoder.encode(response)
		if let responseOutputPath {
			try data.write(to: URL(fileURLWithPath: responseOutputPath), options: .atomic)
		}
		print("\(helperMarkerBase64)\(data.base64EncodedString())")
		fflush(stdout)
		Darwin.exit(response.ok ? EXIT_SUCCESS : EXIT_FAILURE)
	} catch {
		let fallback = "{\"ok\":false,\"error\":\"Failed to encode response\"}"
		if let responseOutputPath {
			try? fallback.data(using: .utf8)?.write(to: URL(fileURLWithPath: responseOutputPath), options: .atomic)
		}
		print(fallback)
		fflush(stdout)
		Darwin.exit(EXIT_FAILURE)
	}
}

private func emitError(_ message: String, request: Request? = nil) -> Never {
	let fallback = request ?? Request(name: "error", packet: nil, expectedResponseCommand: nil, message: "Error", timeout: 0)
	var response = baseResponse(for: fallback, ok: false)
	response.error = message
	response.message = message
	emit(response)
}

final class BluetoothRunner: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
	private let request: Request
	private var central: CBCentralManager!
	private var target: CBPeripheral?
	private var writeCharacteristic: CBCharacteristic?
	private var notifyCharacteristic: CBCharacteristic?
	private var wrote = false
	private var finished = false
	private var events: [String] = []
	private var timeoutTimer: Timer?

	init(request: Request) {
		self.request = request
		super.init()
		central = CBCentralManager(delegate: self, queue: DispatchQueue.main)
		timeoutTimer = Timer.scheduledTimer(withTimeInterval: request.timeout, repeats: false) { [weak self] _ in
			self?.finishError("Timed out waiting for Nothing Ear")
		}
	}

	func centralManagerDidUpdateState(_ central: CBCentralManager) {
		guard central.state == .poweredOn else {
			finishError("Bluetooth is not powered on (state \(central.state.rawValue))")
			return
		}

		let rawConnected = central.retrieveConnectedPeripherals(withServices: [shortServiceUUID])
			+ central.retrieveConnectedPeripherals(withServices: [serviceUUID])
		var seen = Set<UUID>()
		let connected = rawConnected.filter { seen.insert($0.identifier).inserted }
		if let peripheral = connected.first {
			connect(peripheral)
			return
		}

		central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
	}

	func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
		let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""
		let uuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
		if name.lowercased().contains("nothing") || uuids.contains(shortServiceUUID) || uuids.contains(serviceUUID) {
			central.stopScan()
			connect(peripheral)
		}
	}

	func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
		peripheral.delegate = self
		peripheral.discoverServices([shortServiceUUID, serviceUUID])
	}

	func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
		finishError("Failed to connect: \(error?.localizedDescription ?? "unknown error")")
	}

	func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
		if let error {
			finishError("Service discovery failed: \(error.localizedDescription)")
			return
		}
		guard let services = peripheral.services, !services.isEmpty else {
			finishError("Nothing Ear FD90 service not found")
			return
		}
		for service in services {
			peripheral.discoverCharacteristics([writeUUID, notifyUUID], for: service)
		}
	}

	func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
		if let error {
			finishError("Characteristic discovery failed: \(error.localizedDescription)")
			return
		}

		for characteristic in service.characteristics ?? [] {
			if characteristic.uuid == writeUUID {
				writeCharacteristic = characteristic
			}
			if characteristic.uuid == notifyUUID {
				notifyCharacteristic = characteristic
				peripheral.setNotifyValue(true, for: characteristic)
			}
		}

		if request.packet == nil {
			finishStatusIfReady()
		} else {
			maybeWrite(peripheral)
		}
	}

	func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
		if let error {
			finishError("Notify setup failed: \(error.localizedDescription)")
			return
		}
		maybeWrite(peripheral)
	}

	func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
		if let error {
			finishError("Write failed: \(error.localizedDescription)")
		}
	}

	func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
		if let error {
			finishError("Notify read failed: \(error.localizedDescription)")
			return
		}
		guard let data = characteristic.value else { return }
		guard let frame = parseFrame(data) else {
			events.append(hex(data))
			return
		}

		guard let expected = request.expectedResponseCommand else { return }
		if frame.command == expected {
			finish(frame: frame)
		} else {
			events.append("\(hexCommand(frame.command)) \(hex(frame.payload))")
		}
	}

	private func connect(_ peripheral: CBPeripheral) {
		target = peripheral
		peripheral.delegate = self
		central.connect(peripheral)
	}

	private func finishStatusIfReady() {
		guard writeCharacteristic != nil, notifyCharacteristic != nil else { return }
		var response = baseResponse(for: request, ok: true)
		response.helperReady = true
		response.deviceFound = true
		response.deviceName = target?.name
		response.deviceIdentifier = target?.identifier.uuidString
		response.message = "Ready"
		finish(response)
	}

	private func maybeWrite(_ peripheral: CBPeripheral) {
		guard !wrote, let packet = request.packet, let writeCharacteristic else { return }
		if let notifyCharacteristic, !notifyCharacteristic.isNotifying { return }
		let type: CBCharacteristicWriteType = writeCharacteristic.properties.contains(.write) ? .withResponse : .withoutResponse
		peripheral.writeValue(packet, for: writeCharacteristic, type: type)
		wrote = true
	}

	private func finish(frame: PacketFrame) {
		var response = baseResponse(for: request, ok: true)
		response.helperReady = true
		response.deviceFound = true
		response.deviceName = target?.name
		response.deviceIdentifier = target?.identifier.uuidString
		response.events = events
		enrich(&response, with: frame, request: request)
		finish(response)
	}

	private func finishError(_ message: String) {
		var response = baseResponse(for: request, ok: false)
		response.helperReady = writeCharacteristic != nil && notifyCharacteristic != nil
		response.deviceFound = target != nil
		response.deviceName = target?.name
		response.deviceIdentifier = target?.identifier.uuidString
		response.message = message
		response.error = message
		response.events = events
		finish(response)
	}

	private func finish(_ response: HelperResponse) -> Never {
		if finished {
			Darwin.exit(response.ok ? EXIT_SUCCESS : EXIT_FAILURE)
		}
		finished = true
		timeoutTimer?.invalidate()
		if let target {
			central.cancelPeripheralConnection(target)
		}
		emit(response)
	}
}

@main
struct NothingEarHelper {
	static func main() {
		do {
			let request = try parseRequest(arguments: Array(CommandLine.arguments.dropFirst()))
			let runner = BluetoothRunner(request: request)
			withExtendedLifetime(runner) {
				CFRunLoopRun()
			}
			emitError("Run loop exited unexpectedly", request: request)
		} catch {
			emitError(error.localizedDescription)
		}
	}
}
