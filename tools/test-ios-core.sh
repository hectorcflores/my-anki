#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node tools/export-ios-scheduler-fixtures.mjs
TEST_BINARY="$(mktemp -d)/myanki-core"
trap 'rm -f "$TEST_BINARY"; rmdir "$(dirname "$TEST_BINARY")"' EXIT
SWIFT_COMPILER="$(xcrun --find swiftc)"
MAC_SDK="$(xcrun --sdk macosx --show-sdk-path)"
"$SWIFT_COMPILER" -sdk "$MAC_SDK" ios/MyAnki/Scheduler.swift ios/MyAnki/StudyCore.swift ios/MyAnki/CloudAPI.swift ios/MyAnki/CatalogMerge.swift ios/MyAnkiTests/main.swift -o "$TEST_BINARY"
"$TEST_BINARY" app/test/fixtures/ios-scheduler.json
"$SWIFT_COMPILER" -parse-as-library -sdk "$MAC_SDK" ios/MyAnki/Scheduler.swift ios/MyAnki/StudyCore.swift ios/MyAnki/CloudAPI.swift ios/MyAnkiTests/Cloud/main.swift -o "$TEST_BINARY"
"$TEST_BINARY"
