using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BoxingCoach.Desktop.Services;

internal sealed record AuthSession(
    string Token,
    string RefreshToken,
    long ExpiresAt);

internal sealed class DpapiSessionStore
{
    private const uint CryptProtectUiForbidden = 0x1;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("BoxingCoach.Desktop.AuthSession.v1");
    private readonly string _path;

    public DpapiSessionStore(string? path = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BoxingCoach", "auth", "session.bin");
    }

    public AuthSession? Load()
    {
        if (!File.Exists(_path))
        {
            return null;
        }

        try
        {
            var encrypted = File.ReadAllBytes(_path);
            var plaintext = Unprotect(encrypted);
            try
            {
                return JsonSerializer.Deserialize<AuthSession>(plaintext);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plaintext);
            }
        }
        catch (Exception error) when (error is IOException or JsonException or CryptographicException or Win32Exception)
        {
            DesktopDiagnostics.Write(error);
            return null;
        }
    }

    public void Save(AuthSession session)
    {
        var directory = Path.GetDirectoryName(_path)!;
        Directory.CreateDirectory(directory);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(session);
        try
        {
            var encrypted = Protect(plaintext);
            var temporaryPath = _path + ".tmp";
            File.WriteAllBytes(temporaryPath, encrypted);
            File.Move(temporaryPath, _path, true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    public void Clear()
    {
        try
        {
            if (File.Exists(_path))
            {
                File.Delete(_path);
            }
        }
        catch (IOException error)
        {
            DesktopDiagnostics.Write(error);
        }
    }

    private static byte[] Protect(byte[] plaintext)
    {
        var input = AllocateBlob(plaintext);
        var entropy = AllocateBlob(Entropy);
        DataBlob output = default;
        try
        {
            if (!CryptProtectData(
                    ref input,
                    "BoxingCoach session",
                    ref entropy,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    CryptProtectUiForbidden,
                    out output))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            return CopyBlob(output);
        }
        finally
        {
            FreeAllocatedBlob(input);
            FreeAllocatedBlob(entropy);
            FreeSystemBlob(output);
        }
    }

    private static byte[] Unprotect(byte[] encrypted)
    {
        var input = AllocateBlob(encrypted);
        var entropy = AllocateBlob(Entropy);
        DataBlob output = default;
        try
        {
            if (!CryptUnprotectData(
                    ref input,
                    IntPtr.Zero,
                    ref entropy,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    CryptProtectUiForbidden,
                    out output))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            return CopyBlob(output);
        }
        finally
        {
            FreeAllocatedBlob(input);
            FreeAllocatedBlob(entropy);
            FreeSystemBlob(output);
        }
    }

    private static DataBlob AllocateBlob(byte[] bytes)
    {
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        return new DataBlob { Size = bytes.Length, Data = pointer };
    }

    private static byte[] CopyBlob(DataBlob blob)
    {
        var bytes = new byte[blob.Size];
        if (blob.Size > 0)
        {
            Marshal.Copy(blob.Data, bytes, 0, blob.Size);
        }
        return bytes;
    }

    private static void FreeAllocatedBlob(DataBlob blob)
    {
        if (blob.Data != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(blob.Data);
        }
    }

    private static void FreeSystemBlob(DataBlob blob)
    {
        if (blob.Data != IntPtr.Zero)
        {
            LocalFree(blob.Data);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Size;
        public IntPtr Data;
    }

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref DataBlob dataIn,
        string description,
        ref DataBlob optionalEntropy,
        IntPtr reserved,
        IntPtr promptStructure,
        uint flags,
        out DataBlob dataOut);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref DataBlob dataIn,
        IntPtr description,
        ref DataBlob optionalEntropy,
        IntPtr reserved,
        IntPtr promptStructure,
        uint flags,
        out DataBlob dataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr memory);
}
