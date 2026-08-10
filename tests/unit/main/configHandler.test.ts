import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBackupRaw, mockBackupDestroy } = vi.hoisted(() => ({
  mockBackupRaw: vi.fn(),
  mockBackupDestroy: vi.fn(),
}));

vi.mock("knex", () => ({
  default: vi.fn(() => ({
    raw: mockBackupRaw,
    destroy: mockBackupDestroy,
  })),
}));

// electron-store 모킹
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();

const mockStoreInstance = {
  store: {
    theme: "auto",
    libraryFolders: [],
    archivedLibraryFolders: [],
    prioritizeKoreanTitles: false,
  },
  get: mockGet,
  set: mockSet,
  delete: mockDelete,
};

vi.mock("electron-store", () => ({
  default: vi.fn(() => mockStoreInstance),
}));

// electron 모듈 모킹 (dialog, app 등)
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/mock/user/data"),
    exit: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

// DB 모킹
vi.mock("../../../src/main/db/index.js", () => ({
  default: vi.fn(),
  closeDbConnection: vi.fn(),
}));

// fs 모킹
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    copyFile: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    rename: vi.fn(),
  },
  copyFile: vi.fn(),
  unlink: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
}));

// directoryHandler와 thumbnailHandler 모킹
vi.mock("../../../src/main/handlers/directoryHandler.js", () => ({
  cleanupMissingBooks: vi.fn(),
  forgetBooksUnderPath: vi.fn(),
  markBooksOfflineUnderPath: vi.fn(),
  scanDirectory: vi.fn(),
}));

vi.mock("../../../src/main/handlers/thumbnailHandler.js", () => ({
  handleGenerateThumbnail: vi.fn(),
}));

// 테스트 대상 함수 import (모킹 후에 import 해야 함)
const {
  handleGetConfig,
  handleGetConfigValue,
  handleSetConfig,
  handleSetLockPassword,
  handleVerifyLockPassword,
  handleClearLockPassword,
  handleRestoreDatabase,
  handleResetAllData,
  handleRemoveLibraryFolder,
  handleRestoreLibraryFolder,
  handleForgetLibraryFolder,
  restartApp,
} = await import("../../../src/main/handlers/configHandler.js");
const { app, dialog } = await import("electron");
const { existsSync } = await import("fs");
const { default: fs } = await import("fs/promises");
const { closeDbConnection } = await import("../../../src/main/db/index.js");
const { forgetBooksUnderPath, markBooksOfflineUnderPath } =
  await import("../../../src/main/handlers/directoryHandler.js");

describe("configHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.copyFile).mockResolvedValue();
    vi.mocked(fs.rm).mockResolvedValue();
    vi.mocked(fs.rename).mockResolvedValue();
    vi.mocked(fs.unlink).mockResolvedValue();
    mockBackupRaw.mockResolvedValue([{ quick_check: "ok" }]);
    mockBackupDestroy.mockResolvedValue(undefined);

    // mockSet의 기본 동작 설정 (에러를 던지지 않도록)
    mockSet.mockImplementation(() => {
      // 아무것도 안함 (성공)
    });

    mockGet.mockReturnValue(undefined);
    mockDelete.mockImplementation(() => {
      // 아무것도 안함 (성공)
    });
  });

  it("개발 모드 재시작은 개발 서버가 처리할 종료 코드를 사용함", () => {
    restartApp(true);

    expect(app.exit).toHaveBeenCalledWith(75);
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  describe("handleGetConfig", () => {
    it("전체 설정을 반환해야 함", async () => {
      const result = await handleGetConfig();

      expect(result).toEqual(mockStoreInstance.store);
    });
  });

  describe("handleGetConfigValue", () => {
    it("특정 키의 설정 값을 반환해야 함", async () => {
      mockGet.mockReturnValue("dark");

      const result = await handleGetConfigValue("theme");

      expect(mockGet).toHaveBeenCalledWith("theme");
      expect(result).toBe("dark");
    });

    it("존재하지 않는 키는 undefined를 반환해야 함", async () => {
      mockGet.mockReturnValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handleGetConfigValue("nonExistentKey" as any);

      expect(result).toBeUndefined();
    });
  });

  describe("handleSetConfig", () => {
    it("설정 값을 저장해야 함", async () => {
      const result = await handleSetConfig({
        key: "theme",
        value: "dark",
      });

      expect(result.success).toBe(true);
      expect(mockSet).toHaveBeenCalledWith("theme", "dark");
    });

    it("잘못된 설정 저장 시 에러를 반환해야 함", async () => {
      const errorMessage = "Invalid config key";
      mockSet.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const result = await handleSetConfig({
        key: "theme",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value: "invalid" as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
    });
  });

  describe("library folder archive lifecycle", () => {
    const folderPath = "C:\\library";
    const archivedFolder = {
      path: folderPath,
      removedAt: "2026-08-10T00:00:00.000Z",
    };

    it("archives records when removing a registered folder", async () => {
      mockGet.mockImplementation((key: string) =>
        key === "libraryFolders" ? [folderPath] : [],
      );
      vi.mocked(markBooksOfflineUnderPath).mockResolvedValue(3);

      const result = await handleRemoveLibraryFolder(folderPath);

      expect(result).toMatchObject({ success: true, archivedBooks: 3 });
      expect(markBooksOfflineUnderPath).toHaveBeenCalledWith(folderPath);
      expect(forgetBooksUnderPath).not.toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith("libraryFolders", []);
      expect(mockSet).toHaveBeenCalledWith("archivedLibraryFolders", [
        expect.objectContaining({ path: folderPath }),
      ]);
    });

    it("restores an archived folder to active configuration", async () => {
      mockGet.mockImplementation((key: string) =>
        key === "libraryFolders" ? [] : [archivedFolder],
      );

      const result = await handleRestoreLibraryFolder(folderPath);

      expect(result).toEqual({ success: true, folders: [folderPath] });
      expect(mockSet).toHaveBeenCalledWith("libraryFolders", [folderPath]);
      expect(mockSet).toHaveBeenCalledWith("archivedLibraryFolders", []);
    });

    it("permanently forgets records only from an archived folder", async () => {
      mockGet.mockReturnValue([archivedFolder]);
      vi.mocked(forgetBooksUnderPath).mockResolvedValue(3);

      const result = await handleForgetLibraryFolder(folderPath);

      expect(result).toEqual({ success: true, removedBooks: 3 });
      expect(forgetBooksUnderPath).toHaveBeenCalledWith(folderPath);
      expect(mockSet).toHaveBeenCalledWith("archivedLibraryFolders", []);
    });
  });

  describe("비밀번호 관리", () => {
    describe("handleSetLockPassword", () => {
      it("비밀번호를 암호화하여 저장해야 함", async () => {
        const password = "mySecurePassword123";

        const result = await handleSetLockPassword(password);

        // 디버깅: 에러 확인
        if (!result.success) {
          console.log(">>>>>>>>>>>>>> Error:", result.error);
        }

        expect(result.success).toBe(true);
        expect(mockSet).toHaveBeenCalledWith(
          "appLockPassword",
          expect.stringMatching(/^[a-f0-9]{32}:[a-f0-9]{128}$/), // salt:hash 형식
        );

        // 저장된 값 검증
        const savedValue = mockSet.mock.calls[0][1] as string;
        const [salt, hash] = savedValue.split(":");

        // salt는 16바이트(32글자 hex)여야 함
        expect(salt).toHaveLength(32);

        // hash는 64바이트(128글자 hex)여야 함
        expect(hash).toHaveLength(128);

        // 실제로 비밀번호가 올바르게 암호화되었는지 검증
        const verifyHash = crypto
          .pbkdf2Sync(password, salt, 1000, 64, "sha512")
          .toString("hex");
        expect(verifyHash).toBe(hash);
      });

      it("암호화 실패 시 에러를 반환해야 함", async () => {
        const errorMessage = "Encryption failed";
        mockSet.mockImplementation(() => {
          throw new Error(errorMessage);
        });

        const result = await handleSetLockPassword("password");

        expect(result.success).toBe(false);
        expect(result.error).toBe(errorMessage);
      });
    });

    describe("handleVerifyLockPassword", () => {
      it("올바른 비밀번호는 검증을 통과해야 함", async () => {
        const password = "correctPassword";
        const salt = crypto.randomBytes(16).toString("hex");
        const hash = crypto
          .pbkdf2Sync(password, salt, 1000, 64, "sha512")
          .toString("hex");

        mockGet.mockReturnValue(`${salt}:${hash}`);

        const result = await handleVerifyLockPassword(password);

        expect(result.success).toBe(true);
      });

      it("잘못된 비밀번호는 검증을 실패해야 함", async () => {
        const correctPassword = "correctPassword";
        const wrongPassword = "wrongPassword";
        const salt = crypto.randomBytes(16).toString("hex");
        const hash = crypto
          .pbkdf2Sync(correctPassword, salt, 1000, 64, "sha512")
          .toString("hex");

        mockGet.mockReturnValue(`${salt}:${hash}`);

        const result = await handleVerifyLockPassword(wrongPassword);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid password.");
      });

      it("비밀번호가 설정되지 않은 경우 에러를 반환해야 함", async () => {
        mockGet.mockReturnValue(undefined);

        const result = await handleVerifyLockPassword("anyPassword");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Password not set.");
      });

      it("검증 중 오류 발생 시 에러를 반환해야 함", async () => {
        mockGet.mockReturnValue("invalid:format:with:too:many:colons");

        const result = await handleVerifyLockPassword("password");

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe("handleClearLockPassword", () => {
      it("비밀번호를 삭제해야 함", async () => {
        const result = await handleClearLockPassword();

        expect(result.success).toBe(true);
        expect(mockDelete).toHaveBeenCalledWith("appLockPassword");
      });

      it("삭제 실패 시 에러를 반환해야 함", async () => {
        const errorMessage = "Delete failed";
        mockDelete.mockImplementation(() => {
          throw new Error(errorMessage);
        });

        const result = await handleClearLockPassword();

        expect(result.success).toBe(false);
        expect(result.error).toBe(errorMessage);
      });
    });

    describe("비밀번호 암호화 보안 검증", () => {
      it("같은 비밀번호라도 매번 다른 salt를 생성해야 함", async () => {
        const password = "samePassword";

        await handleSetLockPassword(password);
        const firstCall = mockSet.mock.calls[0][1] as string;
        const [firstSalt] = firstCall.split(":");

        mockSet.mockClear();

        await handleSetLockPassword(password);
        const secondCall = mockSet.mock.calls[0][1] as string;
        const [secondSalt] = secondCall.split(":");

        // 같은 비밀번호지만 salt는 달라야 함
        expect(firstSalt).not.toBe(secondSalt);
      });

      it("salt가 충분히 랜덤해야 함 (16바이트)", async () => {
        const password = "testPassword";
        const salts = new Set<string>();

        // 10번 반복 실행
        for (let i = 0; i < 10; i++) {
          await handleSetLockPassword(password);
          const savedValue = mockSet.mock.calls[i][1] as string;
          const [salt] = savedValue.split(":");
          salts.add(salt);
        }

        // 10번 모두 다른 salt가 생성되어야 함
        expect(salts.size).toBe(10);
      });
    });
  });

  describe("데이터 교체 실패 안전성", () => {
    it("백업 준비가 실패하면 열린 DB를 닫지 않음", async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ["/backup"],
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error("copy failed"));

      const result = await handleRestoreDatabase({
        sender: {},
      } as Electron.IpcMainInvokeEvent);

      expect(result.success).toBe(false);
      expect(closeDbConnection).not.toHaveBeenCalled();
      expect(app.relaunch).not.toHaveBeenCalled();
    });

    it("백업 검증이 실패하면 열린 DB를 닫지 않음", async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ["/backup"],
      });
      vi.mocked(existsSync).mockReturnValue(true);
      mockBackupRaw.mockRejectedValueOnce(new Error("invalid backup"));

      const result = await handleRestoreDatabase({
        sender: {},
      } as Electron.IpcMainInvokeEvent);

      expect(result.success).toBe(false);
      expect(closeDbConnection).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it("초기화가 DB 종료 후 실패하면 앱을 재시작", async () => {
      vi.useFakeTimers();
      vi.mocked(closeDbConnection).mockResolvedValue();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.unlink).mockRejectedValueOnce(new Error("unlink failed"));

      const result = await handleResetAllData();
      vi.runAllTimers();

      expect(result.success).toBe(false);
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.quit).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
