//! Compile the Swift package with `swift build` and link it, without swift-rs.
//! Only runs for macOS *targets* (decided via CARGO_CFG_TARGET_OS, not host cfg).
use std::{env, path::PathBuf, process::Command};

const PACKAGE: &str = "SayItFM";
const PACKAGE_DIR: &str = "swift/SayItFM";
// Must equal bundle.macOS.minimumSystemVersion and Package.swift `platforms`.
const MACOS_MIN: &str = "13.0";

fn run(cmd: &mut Command) -> String {
    let out = cmd.output().unwrap_or_else(|e| panic!("failed to run {cmd:?}: {e}"));
    if !out.status.success() {
        panic!("{cmd:?} failed:\n{}", String::from_utf8_lossy(&out.stderr));
    }
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn main() {
    println!("cargo:rerun-if-changed={PACKAGE_DIR}/Package.swift");
    println!("cargo:rerun-if-changed={PACKAGE_DIR}/Sources");
    println!("cargo:rerun-if-env-changed=SDKROOT");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("unsupported macOS arch {other}"),
    };
    let config = if env::var("PROFILE").as_deref() == Ok("release") { "release" } else { "debug" };
    let sdk = env::var("SDKROOT")
        .unwrap_or_else(|_| run(Command::new("xcrun").args(["--sdk", "macosx", "--show-sdk-path"])));
    let build_path = PathBuf::from(env::var("OUT_DIR").unwrap()).join("swiftpm");
    let triple = format!("{arch}-apple-macosx{MACOS_MIN}");

    let mut swift = Command::new("swift");
    swift
        .current_dir(PACKAGE_DIR)
        .args(["build", "-c", config, "--triple", &triple, "--sdk", &sdk])
        .arg("--build-path")
        .arg(&build_path);
    let status = swift.status().expect("swift not found (install Xcode or CLT)");
    assert!(status.success(), "swift build failed");

    // `--show-bin-path` is layout-agnostic (legacy <arch>-apple-macosx/<cfg> vs Swift Build's Products/<Cfg>).
    let bin = run(swift.arg("--show-bin-path"));
    println!("cargo:rustc-link-search=native={bin}");
    println!("cargo:rustc-link-lib=static={PACKAGE}");

    // Swift runtime (in the OS since 10.14.4) + compiler-rt for `#available` (___isPlatformVersionAtLeast).
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    // Toolchain's own swift libs (swiftCompatibility56 etc. are static archives living next to swiftc).
    let swiftc = PathBuf::from(run(Command::new("xcrun").args(["--find", "swiftc"])));
    let toolchain_swift = swiftc.parent().unwrap().parent().unwrap().join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", toolchain_swift.display());
    let resource = run(Command::new("clang").arg("--print-resource-dir"));
    println!("cargo:rustc-link-search=native={resource}/lib/darwin");
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
