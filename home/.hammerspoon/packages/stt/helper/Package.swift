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
		.package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5"),
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
