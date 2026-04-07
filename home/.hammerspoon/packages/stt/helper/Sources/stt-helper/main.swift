import AVFoundation
import Darwin
import FluidAudio
import Foundation

private let helperMarkerBase64 = "__STT_JSON_B64__"
private let minimumDuration: TimeInterval = 1.5
private let expectedSampleRate: Double = 16_000

struct HelperResponse: Encodable {
	let ok: Bool
	let helperReady: Bool
	let modelAvailable: Bool
	let cacheRoot: String
	let modelPath: String?
	let message: String?
	let text: String?
	let error: String?
}

struct PreparedAudio {
	let url: URL
	private let cleanupURL: URL?

	init(url: URL, cleanupURL: URL?) {
		self.url = url
		self.cleanupURL = cleanupURL
	}

	func cleanup() {
		guard let cleanupURL else { return }
		try? FileManager.default.removeItem(at: cleanupURL)
	}
}

enum HelperError: LocalizedError {
	case invalidCommand
	case missingInput
	case unsupportedPlatform
	case modelMissing
	case modelNotUsable(String)
	case emptyTranscript
	case unsupportedAudioFormat(String)

	var errorDescription: String? {
		switch self {
		case .invalidCommand:
			return "Usage: stt-helper status | download | delete | transcribe --input /path/file.wav"
		case .missingInput:
			return "Missing required --input argument."
		case .unsupportedPlatform:
			return "Parakeet requires Apple Silicon on macOS 14+."
		case .modelMissing:
			return "Parakeet model missing. Open the STT menu and click Download Model."
		case let .modelNotUsable(message):
			return message
		case .emptyTranscript:
			return "No speech detected in audio."
		case let .unsupportedAudioFormat(message):
			return message
		}
	}
}

enum AudioPreparer {
	static func prepare(url: URL) throws -> PreparedAudio {
		let audioFile = try AVAudioFile(forReading: url)
		let format = audioFile.processingFormat

		guard format.channelCount == 1 else {
			throw HelperError.unsupportedAudioFormat("Expected mono WAV input.")
		}

		guard abs(format.sampleRate - expectedSampleRate) < 0.5 else {
			throw HelperError.unsupportedAudioFormat("Expected 16kHz WAV input.")
		}

		guard format.commonFormat == .pcmFormatFloat32 else {
			throw HelperError.unsupportedAudioFormat("Expected 32-bit float WAV input.")
		}

		let duration = Double(audioFile.length) / format.sampleRate
		guard duration < minimumDuration else {
			return PreparedAudio(url: url, cleanupURL: nil)
		}

		let minimumFrames = AVAudioFrameCount((minimumDuration * format.sampleRate).rounded(.up))
		let existingFrames = max(audioFile.length, 0)
		let sourceCapacity = max(AVAudioFrameCount(min(existingFrames, AVAudioFramePosition(AVAudioFrameCount.max))), 1)

		guard
			let readBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: sourceCapacity),
			let paddedBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: minimumFrames)
		else {
			throw HelperError.unsupportedAudioFormat("Unable to allocate audio buffers.")
		}

		try audioFile.read(into: readBuffer)
		let framesRead = min(readBuffer.frameLength, minimumFrames)

		guard
			let sourceChannels = readBuffer.floatChannelData,
			let paddedChannels = paddedBuffer.floatChannelData
		else {
			throw HelperError.unsupportedAudioFormat("Expected Float32 channel data.")
		}

		for channel in 0..<Int(format.channelCount) {
			let destination = paddedChannels[channel]
			let source = sourceChannels[channel]
			if framesRead > 0 {
				destination.update(from: source, count: Int(framesRead))
			}
			let padCount = Int(minimumFrames - framesRead)
			if padCount > 0 {
				destination.advanced(by: Int(framesRead)).initialize(repeating: 0, count: padCount)
			}
		}

		paddedBuffer.frameLength = minimumFrames

		let paddedURL = makePaddedURL(from: url)
		if FileManager.default.fileExists(atPath: paddedURL.path) {
			try FileManager.default.removeItem(at: paddedURL)
		}

		let paddedFile = try AVAudioFile(forWriting: paddedURL, settings: audioFile.fileFormat.settings)
		try paddedFile.write(from: paddedBuffer)
		return PreparedAudio(url: paddedURL, cleanupURL: paddedURL)
	}

	private static func makePaddedURL(from url: URL) -> URL {
		let dir = url.deletingLastPathComponent()
		let stem = url.deletingPathExtension().lastPathComponent
		return dir.appendingPathComponent("\(stem)-parakeet-padded.wav")
	}
}

@main
struct SttHelper {
	static func main() async {
		do {
			try configureLocalCache()
			guard isSupportedPlatform() else {
				throw HelperError.unsupportedPlatform
			}
			let response = try await run(arguments: Array(CommandLine.arguments.dropFirst()))
			emit(response)
			Darwin.exit(response.ok ? EXIT_SUCCESS : EXIT_FAILURE)
		} catch {
			log("error: \(error.localizedDescription)")
			emit(errorResponse(error.localizedDescription))
			Darwin.exit(EXIT_FAILURE)
		}
	}

	private static func run(arguments: [String]) async throws -> HelperResponse {
		guard let command = arguments.first else {
			throw HelperError.invalidCommand
		}

		switch command {
		case "status":
			log("status requested path=\(reportedModelPath().path)")
			return statusResponse(message: modelAvailable() ? "Ready" : "Model missing")
		case "download":
			if modelAvailable() {
				log("download skipped existing=\(preferredModelDirectory().path)")
				return statusResponse(message: "Model already downloaded")
			}
			let target = preferredModelDirectory()
			log("download start target=\(target.path)")
			_ = try await AsrModels.download(to: target, version: .v3)
			guard modelAvailable() else {
				throw HelperError.modelNotUsable("Model download finished, but STT could not find the model files.")
			}
			log("download finished path=\(target.path)")
			return statusResponse(message: "Model downloaded")
		case "delete":
			let target = preferredModelDirectory()
			if modelAvailable() {
				log("delete start path=\(target.path)")
				try FileManager.default.removeItem(at: target)
				log("delete finished path=\(target.path)")
			} else {
				log("delete skipped missing=\(target.path)")
			}
			return statusResponse(message: "Model deleted")
		case "transcribe":
			let inputPath = try parseInputPath(arguments: Array(arguments.dropFirst()))
			guard modelAvailable() else {
				throw HelperError.modelMissing
			}
			let modelDirectory = preferredModelDirectory()
			log("transcribe start input=\(inputPath.path) modelPath=\(modelDirectory.path)")

			let prepared = try AudioPreparer.prepare(url: inputPath)
			defer { prepared.cleanup() }

			let models = try await AsrModels.load(from: modelDirectory, version: .v3)
			let manager = AsrManager(config: .default)
			try await manager.loadModels(models)
			let result = try await manager.transcribe(prepared.url, source: .microphone)
			let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !text.isEmpty else {
				throw HelperError.emptyTranscript
			}
			return statusResponse(message: "Transcription complete", text: text)
		default:
			throw HelperError.invalidCommand
		}
	}

	private static func parseInputPath(arguments: [String]) throws -> URL {
		var index = 0
		while index < arguments.count {
			if arguments[index] == "--input" {
				let valueIndex = index + 1
				guard valueIndex < arguments.count else {
					throw HelperError.missingInput
				}
				return URL(fileURLWithPath: arguments[valueIndex])
			}
			index += 1
		}
		throw HelperError.missingInput
	}

	private static func configureLocalCache() throws {
		let fm = FileManager.default
		try fm.createDirectory(at: runtimeRoot(), withIntermediateDirectories: true, attributes: nil)
		try fm.createDirectory(at: cacheRoot(), withIntermediateDirectories: true, attributes: nil)
		setenv("XDG_CACHE_HOME", cacheRoot().path, 1)
	}

	private static func runtimeRoot() -> URL {
		FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent("Library/Application Support/Hammerspoon/STT", isDirectory: true)
	}

	private static func cacheRoot() -> URL {
		runtimeRoot().appendingPathComponent("cache", isDirectory: true)
	}

	private static func expectedModelPath() -> URL {
		preferredModelDirectory()
	}

	private static func preferredModelDirectory() -> URL {
		let defaultDirectory = AsrModels.defaultCacheDirectory(for: .v3)
		return cacheRoot()
			.appendingPathComponent("FluidAudio/Models", isDirectory: true)
			.appendingPathComponent(defaultDirectory.lastPathComponent, isDirectory: true)
	}

	private static func reportedModelPath() -> URL {
		preferredModelDirectory()
	}

	private static func modelAvailable() -> Bool {
		AsrModels.modelsExist(at: preferredModelDirectory(), version: .v3)
	}

	private static func statusResponse(message: String, text: String? = nil) -> HelperResponse {
		HelperResponse(
			ok: true,
			helperReady: true,
			modelAvailable: modelAvailable(),
			cacheRoot: cacheRoot().path,
			modelPath: reportedModelPath().path,
			message: message,
			text: text,
			error: nil
		)
	}

	private static func errorResponse(_ message: String) -> HelperResponse {
		HelperResponse(
			ok: false,
			helperReady: isSupportedPlatform(),
			modelAvailable: modelAvailable(),
			cacheRoot: cacheRoot().path,
			modelPath: reportedModelPath().path,
			message: nil,
			text: nil,
			error: message
		)
	}

	private static func emit(_ response: HelperResponse) {
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.sortedKeys]
		guard let data = try? encoder.encode(response), let json = String(data: data, encoding: .utf8) else {
			let fallback = Data("{\"error\":\"encoding failed\",\"ok\":false}".utf8).base64EncodedString()
			FileHandle.standardOutput.write(Data((helperMarkerBase64 + fallback + "\n").utf8))
			return
		}
		let encoded = Data(json.utf8).base64EncodedString()
		FileHandle.standardOutput.write(Data((helperMarkerBase64 + encoded + "\n").utf8))
	}

	private static func isSupportedPlatform() -> Bool {
		#if arch(arm64)
		true
		#else
		false
		#endif
	}

	private static func log(_ message: String) {
		FileHandle.standardError.write(Data(("[stt-helper] " + message + "\n").utf8))
	}
}
