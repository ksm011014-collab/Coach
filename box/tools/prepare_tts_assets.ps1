$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot '../web/vendor/supertonic'
New-Item -ItemType Directory -Force $destination | Out-Null
$sourceRevision = '1e9799e964ea4c0dad7cde993b65c3c813a7b373'
$modelRevision = 'aafc6e32416a594460b32413efc49d7fe4ce6d46'
$runtimeVersion = '1.22.0'
function Get-TtsAsset($url, $relative) {
    $target = Join-Path $destination $relative
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    if (Test-Path -LiteralPath $target) { return }
    Invoke-WebRequest -Uri $url -OutFile "$target.partial"
    Move-Item -LiteralPath "$target.partial" -Destination $target
}
Get-TtsAsset "https://raw.githubusercontent.com/supertone-oss-archive/supertonic/$sourceRevision/web/helper.js" 'helper.mjs'
$helperPath = Join-Path $destination 'helper.mjs'
$helper = [IO.File]::ReadAllText($helperPath).Replace("from 'onnxruntime-web'", "from './ort.wasm.min.mjs'")
if (!$helper.StartsWith('// BoxingCoach:')) { $helper = "// BoxingCoach: changed the runtime import to a same-origin pinned module.`n" + $helper }
[IO.File]::WriteAllText($helperPath, $helper)
Get-TtsAsset "https://raw.githubusercontent.com/supertone-oss-archive/supertonic/$sourceRevision/LICENSE" 'SOURCE-LICENSE.txt'
foreach ($file in @('ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm')) {
    Get-TtsAsset "https://cdn.jsdelivr.net/npm/onnxruntime-web@$runtimeVersion/dist/$file" $file
}
Get-TtsAsset "https://raw.githubusercontent.com/microsoft/onnxruntime/v$runtimeVersion/LICENSE" 'RUNTIME-LICENSE.txt'
foreach ($file in @('onnx/tts.json', 'onnx/unicode_indexer.json', 'onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx', 'onnx/vector_estimator.onnx', 'onnx/vocoder.onnx', 'voice_styles/F1.json', 'LICENSE')) {
    Get-TtsAsset "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/$modelRevision/$file" $file
}
$modelFiles = Invoke-RestMethod "https://huggingface.co/api/models/supertone-oss-archive/supertonic-3/tree/${modelRevision}?recursive=true"
foreach ($file in $modelFiles) {
    $target = Join-Path $destination $file.path
    if ($file.lfs -and (Test-Path -LiteralPath $target -PathType Leaf)) {
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.lfs.oid) {
            throw "TTS asset checksum mismatch: $($file.path)"
        }
    }
}
$installed = Get-ChildItem -LiteralPath $destination -Recurse -File | Where-Object { $_.Name -ne 'manifest.json' -and $_.Extension -ne '.partial' } | ForEach-Object {
    @{ path = [IO.Path]::GetRelativePath($destination, $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
# Publish readiness only after all downloads succeed. No application data is touched.
@{ engine = 'supertonic-3'; sourceRevision = $sourceRevision; modelRevision = $modelRevision; runtimeVersion = $runtimeVersion; files = @($installed) } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $destination 'manifest.json')
Write-Output 'Supertonic Korean/English browser assets prepared (approximately 415 MB).'
