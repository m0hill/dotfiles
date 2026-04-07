// swift-tools-version: 6.0

import PackageDescription

let package = Package(
	name: "stt-helper",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "stt-helper", targets: ["stt-helper"]),
	],
	dependencies: [
		.package(url: "https://github.com/FluidInference/FluidAudio.git", revision: "f99f8831a5ccdc3957f6fa837f61ff114f0494fa"),
	],
	targets: [
		.executableTarget(
			name: "stt-helper",
			dependencies: [
				.product(name: "FluidAudio", package: "FluidAudio"),
			]
		),
	],
)
