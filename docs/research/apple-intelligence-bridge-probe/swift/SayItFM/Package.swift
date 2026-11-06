// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SayItFM",
    // Must equal the app's minimum macOS (NOT 26) so FoundationModels is weak-linked.
    platforms: [.macOS("13.0")],
    products: [
        .library(name: "SayItFM", type: .static, targets: ["SayItFM"])
    ],
    targets: [
        .target(name: "SayItFM", path: "Sources/SayItFM")
    ]
)
