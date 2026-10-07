using System.IO;
using System.Text.Json;
using System.Speech.Synthesis;

namespace BoxingCoach.Desktop.Services;

internal sealed class NativeSpeech : IDisposable
{
    private CancellationTokenSource? _pending;

    public object Voices()
    {
        using var synthesizer = new SpeechSynthesizer();
        return synthesizer.GetInstalledVoices().Where(voice => voice.Enabled)
            .Select(voice => voice.VoiceInfo)
            .Where(voice => voice.Culture.TwoLetterISOLanguageName is "ko" or "en")
            .Select(voice => new { id = voice.Id, language = voice.Culture.Name, name = voice.Name }).ToArray();
    }

    public async Task<object> SynthesizeAsync(JsonElement payload)
    {
        var language = payload.GetProperty("language").GetString();
        var text = payload.GetProperty("text").GetString();
        if (language is not ("ko" or "en") || string.IsNullOrWhiteSpace(text) || text.Length > 1000)
            throw new InvalidOperationException("Invalid speech request.");
        Stop();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        _pending = cancellation;
        try
        {
            using var synthesizer = new SpeechSynthesizer();
            var voice = synthesizer.GetInstalledVoices().Where(item => item.Enabled).Select(item => item.VoiceInfo)
                .FirstOrDefault(item => item.Culture.TwoLetterISOLanguageName == language)
                ?? throw new InvalidOperationException("speech_voice_missing");
            synthesizer.SelectVoice(voice.Name);
            using var output = new MemoryStream();
            synthesizer.SetOutputToWaveStream(output);
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            synthesizer.SpeakCompleted += (_, args) =>
            {
                if (args.Error is not null) completion.TrySetException(args.Error);
                else if (args.Cancelled) completion.TrySetCanceled();
                else completion.TrySetResult();
            };
            using var registration = cancellation.Token.Register(() =>
            {
                synthesizer.SpeakAsyncCancelAll();
                completion.TrySetCanceled(cancellation.Token);
            });
            synthesizer.SpeakAsync(text);
            await completion.Task;
            cancellation.Token.ThrowIfCancellationRequested();
            synthesizer.SetOutputToNull();
            return new { audio = Convert.ToBase64String(output.ToArray()), contentType = "audio/wav" };
        }
        finally
        {
            if (ReferenceEquals(_pending, cancellation)) _pending = null;
        }
    }

    public object Stop()
    {
        _pending?.Cancel();
        _pending = null;
        return new { stopped = true };
    }

    public void Dispose() => Stop();
}
