// swift-tools-version: 6.0

import PackageDescription

let package = Package(
	name: "nothingear-helper",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.executable(name: "nothingear-helper", targets: ["nothingear-helper"]),
	],
	targets: [
		.executableTarget(
			name: "nothingear-helper",
			exclude: ["Info.plist"],
			linkerSettings: [
				.unsafeFlags([
					"-Xlinker", "-sectcreate",
					"-Xlinker", "__TEXT",
					"-Xlinker", "__info_plist",
					"-Xlinker", "Sources/nothingear-helper/Info.plist",
				]),
			]
		),
	]
)
