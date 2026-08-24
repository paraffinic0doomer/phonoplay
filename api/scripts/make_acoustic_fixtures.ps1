<#
    Synthesise the controlled fixtures the acoustic tests run against.

    These words are deliberately NOT in the reference corpus
    (scripts/build_reference_corpus.ps1). The profiles were built from that
    corpus, so testing on it would only show that the profiles describe their
    own source. Held-out minimal pairs are what actually test the system:

        sank / thank    a correct /s/ against an /s/ produced as /th/
        rag  / wag      a correct /r/ against an /r/ produced as /w/
        lace / race     a correct /l/ against an /l/ produced as /r/

    Each pair differs only in the target sound, so feeding the wrong half
    while asking for the other is exactly the "intentionally altered sound"
    case, using real words rather than something contrived.

    Usage:  powershell -ExecutionPolicy Bypass -File scripts/make_acoustic_fixtures.ps1
#>

Add-Type -AssemblyName System.Speech

$out = Join-Path (Split-Path -Parent $PSScriptRoot) "tests\fixtures"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# One voice for the primary fixtures so the tests are deterministic, plus a
# second voice for "sank" alone — enough to catch a change that only works
# for one speaker without doubling the committed fixture size.
$words = @{
    "speech_sank"  = @("sank",  "Microsoft David Desktop")
    "speech_thank" = @("thank", "Microsoft David Desktop")
    "speech_rag"   = @("rag",   "Microsoft David Desktop")
    "speech_wag"   = @("wag",   "Microsoft David Desktop")
    "speech_lace"  = @("lace",  "Microsoft David Desktop")
    "speech_race"  = @("race",  "Microsoft David Desktop")
    "speech_sank_zira" = @("sank", "Microsoft Zira Desktop")
}

foreach ($name in $words.Keys) {
    $word, $voice = $words[$name]
    $path = Join-Path $out "$name.wav"
    $synth.SelectVoice($voice)
    $synth.Rate = 0
    $synth.SetOutputToWaveFile($path, $format)
    $synth.Speak($word)
    $synth.SetOutputToNull()
    Write-Host "  $name.wav  ($word, $voice)"
}

$synth.Dispose()
Write-Host "Wrote $($words.Count) fixtures to $out"
Write-Host "Now run: .venv/Scripts/python.exe scripts/make_acoustic_fixtures.py"
