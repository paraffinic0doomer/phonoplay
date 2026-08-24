<#
    Synthesise the reference corpus for the acoustic stage.

    Writes one 16 kHz mono WAV per (phoneme, word, voice, rate) into
    api/reference_corpus/<phoneme>/. That directory is gitignored: the audio
    is a build artefact, reproducible from this script. Only the measured
    profiles.json is committed.

    Why synthesised speech: PhonoPlay is a hackathon prototype with no
    licensed corpus of labelled child speech, and inventing reference numbers
    would be exactly the fabrication this project refuses to do. Measuring a
    reproducible corpus with the same code path that scores learners is the
    honest version of a small reference set. Its limits are real and are
    documented in app/acoustic/reference/README.md — two synthetic adult
    voices are not a population.

    Usage:  powershell -ExecutionPolicy Bypass -File scripts/build_reference_corpus.ps1
#>

Add-Type -AssemblyName System.Speech

$root = Join-Path (Split-Path -Parent $PSScriptRoot) "reference_corpus"

# Word-initial tokens only: the segmenter's onset detector is what the
# learner-facing path uses, so the reference must be measured the same way.
$words = @{
    "s"  = @("sun", "see", "sock", "sing", "sail", "seed")
    "th" = @("think", "thin", "thumb", "thick", "thing", "theme")
    "sh" = @("shoe", "ship", "shop", "sheep", "shine", "shell")
    "f"  = @("fun", "fish", "phone", "feet", "four", "fill")
    "t"  = @("toe", "top", "ten", "take", "tool", "time")
    "r"  = @("red", "rabbit", "road", "rain", "ring", "right")
    "l"  = @("light", "leaf", "look", "lake", "line", "lock")
    "w"  = @("wed", "wing", "wood", "water", "walk", "week")
}

# Rate variation is the only speaker-independent variance available from two
# fixed voices. It is not a substitute for real speaker variation, which is
# why the profile builder widens every standard deviation afterwards.
$rates = @(-2, 0, 2)

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() |
    Where-Object { $_.VoiceInfo.Culture.Name -like "en*" } |
    ForEach-Object { $_.VoiceInfo.Name }

if ($voices.Count -eq 0) { throw "No English SAPI voices installed." }
Write-Host "Voices: $($voices -join ', ')"

$count = 0
foreach ($phoneme in $words.Keys) {
    $dir = Join-Path $root $phoneme
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    foreach ($word in $words[$phoneme]) {
        foreach ($voice in $voices) {
            foreach ($rate in $rates) {
                $tag = ($voice -replace '[^A-Za-z]', '')
                $path = Join-Path $dir "$word-$tag-$rate.wav"
                $synth.SelectVoice($voice)
                $synth.Rate = $rate
                $synth.SetOutputToWaveFile($path, $format)
                $synth.Speak($word)
                $synth.SetOutputToNull()
                $count++
            }
        }
    }
    Write-Host "  $phoneme : $($words[$phoneme].Count) words"
}

$synth.Dispose()
Write-Host "Wrote $count files to $root"
