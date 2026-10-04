import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The save dialog has two different contracts and the order of operations is
 * the whole fix. On macOS the dialog hands back a writable path and the bytes
 * follow. On iPadOS `UIDocumentPickerViewController` only exports a file the
 * app already has: tauri-plugin-dialog stages an empty placeholder in the
 * app's Documents directory, exports it, and returns a URL inside the
 * destination provider's container that the app cannot write. Doing it in the
 * desktop order there hands the participant a zero-byte report.
 */

const calls = vi.hoisted(() => ({
  order: [] as string[],
  invoked: [] as { cmd: string; args?: Record<string, unknown> }[],
  dialogMode: "write-to-picked-path" as unknown,
  defaultDir: "/reports",
  picked: null as string | null,
  saveThrows: null as unknown,
  writeThrows: null as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.invoked.push({ cmd, args });
    if (cmd === "export_dialog_mode") return calls.dialogMode;
    if (cmd === "export_default_dir") return calls.defaultDir;
    if (cmd === "export_save_pdf") {
      calls.order.push(`write:${String(args?.path)}`);
      if (calls.writeThrows !== null) throw calls.writeThrows;
      return undefined;
    }
    throw new Error(`unexpected command ${cmd}`);
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: async () => {
    calls.order.push("dialog");
    if (calls.saveThrows !== null) throw calls.saveThrows;
    return calls.picked;
  },
}));

import {
  ExportError,
  ExportUnavailableError,
  savePdf,
  savePdfToDownloads,
} from "./api";

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

beforeEach(() => {
  calls.order = [];
  calls.invoked = [];
  calls.dialogMode = "write-to-picked-path";
  calls.defaultDir = "/reports";
  calls.picked = null;
  calls.saveThrows = null;
  calls.writeThrows = null;
});

function writes() {
  return calls.invoked.filter((call) => call.cmd === "export_save_pdf");
}

describe("save dialog on a platform that returns a writable path", () => {
  it("opens the dialog first, then writes to what the user picked", async () => {
    calls.picked = "/Users/x/Downloads/report.pdf";

    await expect(savePdf("report.pdf", bytes)).resolves.toBe(true);

    expect(calls.order).toEqual(["dialog", "write:/Users/x/Downloads/report.pdf"]);
  });

  it("writes nothing when the user cancels", async () => {
    calls.picked = null;

    await expect(savePdf("report.pdf", bytes)).resolves.toBe(false);

    expect(writes()).toHaveLength(0);
  });
});

describe("save dialog on a platform that exports a staged file", () => {
  beforeEach(() => {
    calls.dialogMode = "export-staged-file";
    calls.defaultDir = "/var/app/Documents";
  });

  it("writes the real bytes into the staging directory BEFORE the picker opens", async () => {
    // The picker copies whatever is at that path. If the write came second,
    // it would target the destination provider's container instead, and the
    // exported copy would be the plugin's empty placeholder.
    calls.picked = "file:///icloud/report.pdf";

    await expect(savePdf("report.pdf", bytes)).resolves.toBe(true);

    expect(calls.order).toEqual(["write:/var/app/Documents/report.pdf", "dialog"]);
  });

  it("never writes to the URL the picker returns", async () => {
    calls.picked = "file:///icloud/report.pdf";

    await savePdf("report.pdf", bytes);

    const paths = writes().map((call) => String(call.args?.path));
    expect(paths).toEqual(["/var/app/Documents/report.pdf"]);
  });

  it("stages under the bare file name the plugin derives from defaultPath", async () => {
    // tauri-plugin-dialog only skips its empty placeholder when a file is
    // already at <Documents>/<fileName>; a different name means the
    // placeholder is created and the participant exports zero bytes.
    calls.picked = "file:///icloud/somewhere-else.pdf";

    await savePdf("guided-report-2026-08-25.pdf", bytes);

    expect(writes()[0]?.args?.path).toBe(
      "/var/app/Documents/guided-report-2026-08-25.pdf",
    );
  });

  it("reports a cancelled picker as not saved, with the report still staged", async () => {
    calls.picked = null;

    await expect(savePdf("report.pdf", bytes)).resolves.toBe(false);

    // Cancelling loses the destination, not the report: the staged copy sits
    // in the app's Documents folder, which the Files app can reach.
    expect(writes().map((call) => String(call.args?.path))).toEqual([
      "/var/app/Documents/report.pdf",
    ]);
  });

  it("does not open the picker when staging fails", async () => {
    calls.writeThrows = { code: "io", message: "disk full" };

    await expect(savePdf("report.pdf", bytes)).rejects.toBeInstanceOf(ExportError);
    expect(calls.order).not.toContain("dialog");
  });
});

describe("dialog mode handshake", () => {
  it("refuses to guess when the backend reports an unknown mode", async () => {
    calls.dialogMode = "whatever-the-next-platform-does";

    await expect(savePdf("report.pdf", bytes)).rejects.toBeInstanceOf(
      ExportUnavailableError,
    );
    expect(writes()).toHaveLength(0);
    expect(calls.order).not.toContain("dialog");
  });
});

describe("hands-free export", () => {
  it("writes into the platform's report directory without a dialog", async () => {
    calls.defaultDir = "/var/app/Documents";

    await expect(savePdfToDownloads("report.pdf", bytes)).resolves.toBe(
      "/var/app/Documents/report.pdf",
    );
    expect(calls.order).toEqual(["write:/var/app/Documents/report.pdf"]);
  });

  it("surfaces a backend write failure as a typed ExportError", async () => {
    calls.writeThrows = { code: "io", message: "read-only volume" };

    await expect(savePdfToDownloads("report.pdf", bytes)).rejects.toBeInstanceOf(
      ExportError,
    );
  });
});
