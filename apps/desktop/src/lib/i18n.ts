import { useEffect, useState } from "react";

/** Tiny i18n. Vietnamese is the default; English is available. Per-machine,
 *  persisted in localStorage and mirrored across windows via the storage event. */

export type Lang = "vi" | "en";
const KEY = "msticky.lang";

const vi = {
  notes: "ghi chú",
  search: "Tìm ghi chú…",
  new: "Mới",
  active: "Đang dùng",
  all: "Tất cả",
  signedInPill: "Đã đồng bộ",
  signInPill: "Đăng nhập",
  offlinePill: "Ngoại tuyến",
  noMatch: "Không có ghi chú khớp tìm kiếm.",
  emptyBoard: "Chưa có ghi chú — bấm Mới.",
  untitled: "Ghi chú chưa đặt tên",
  emptyNote: "Ghi chú trống",
  writePlaceholder: "Viết gì đó…  ( - [ ] để tạo checklist )",
  writeShort: "Viết gì đó…",
  // note window tooltips
  close: "Đóng",
  pin: "Ghim ra desktop",
  onTop: "Luôn trên cùng",
  color: "Màu",
  newNote: "Ghi chú mới",
  openBoard: "Mở bảng",
  deleteNote: "Xoá ghi chú",
  // account & sync
  accountSync: "Tài khoản & Đồng bộ",
  googleBlurb:
    "Đăng nhập bằng tài khoản Google để đồng bộ ghi chú giữa các thiết bị. Ghi chú là riêng tư của bạn.",
  signInGoogle: "Đăng nhập với Google",
  openingBrowser: "Đang mở trình duyệt…",
  advanced: "Cài đặt nâng cao",
  hideAdvanced: "Ẩn cài đặt",
  serverUrl: "Địa chỉ máy chủ",
  signedInAs: "Đã đăng nhập:",
  statusLabel: "Trạng thái:",
  signOut: "Đăng xuất",
  stSignedOut: "chưa đăng nhập",
  stConnecting: "đang kết nối…",
  stSynced: "đã đồng bộ",
  stOffline: "ngoại tuyến (sẽ thử lại)",
  // e2e
  e2eOn: "Mã hoá đầu-cuối: bật",
  e2eOff: "Mã hoá đầu-cuối: tắt",
  e2eLocked: "Mã hoá đầu-cuối: đang khoá",
  enable: "Bật",
  unlock: "Mở khoá",
  e2eBlurb:
    "Mã hoá nội dung ghi chú ngay trên máy để máy chủ không đọc được. Quên mật khẩu này thì ghi chú đã mã hoá không thể khôi phục.",
  newPassphrase: "Mật khẩu mã hoá mới",
  confirmPassphrase: "Nhập lại mật khẩu",
  encPassphrase: "Mật khẩu mã hoá",
  enableEncryption: "Bật mã hoá",
  unlockDevice: "Mở khoá máy này",
  passMismatch: "Mật khẩu không khớp",
  passTooShort: "Dùng ít nhất 6 ký tự",
  wrongPass: "Sai mật khẩu",
  encNotEnabled: "Chưa bật mã hoá",
  // delete dialog
  deleteTitle: "Xoá ghi chú?",
  deleteBody: "Ghi chú sẽ bị xoá trên mọi thiết bị đã đăng nhập của bạn.",
  delete: "Xoá",
  cancel: "Huỷ",
};

type Keys = typeof vi;

const en: Keys = {
  notes: "notes",
  search: "Search notes…",
  new: "New",
  active: "Active",
  all: "All",
  signedInPill: "Synced",
  signInPill: "Sign in",
  offlinePill: "Offline",
  noMatch: "No notes match your search.",
  emptyBoard: "No notes yet — hit New.",
  untitled: "Untitled note",
  emptyNote: "Empty note",
  writePlaceholder: "Write something…  ( - [ ] for a checklist )",
  writeShort: "Write something…",
  close: "Close",
  pin: "Pin to desktop",
  onTop: "Always on top",
  color: "Color",
  newNote: "New note",
  openBoard: "Open board",
  deleteNote: "Delete note",
  accountSync: "Account & Sync",
  googleBlurb:
    "Sign in with your Google account to sync your notes across devices. Your notes are private to you.",
  signInGoogle: "Sign in with Google",
  openingBrowser: "Opening browser…",
  advanced: "Advanced settings",
  hideAdvanced: "Hide settings",
  serverUrl: "Server URL",
  signedInAs: "Signed in as",
  statusLabel: "Status:",
  signOut: "Sign out",
  stSignedOut: "signed out",
  stConnecting: "connecting…",
  stSynced: "synced",
  stOffline: "offline (will retry)",
  e2eOn: "End-to-end encryption: on",
  e2eOff: "End-to-end encryption: off",
  e2eLocked: "End-to-end encryption: locked",
  enable: "Enable",
  unlock: "Unlock",
  e2eBlurb:
    "Encrypts note text on your device so the server can't read it. If you forget this passphrase, encrypted notes can't be recovered.",
  newPassphrase: "New passphrase",
  confirmPassphrase: "Confirm passphrase",
  encPassphrase: "Encryption passphrase",
  enableEncryption: "Enable encryption",
  unlockDevice: "Unlock this device",
  passMismatch: "Passphrases don't match",
  passTooShort: "Use at least 6 characters",
  wrongPass: "Wrong passphrase",
  encNotEnabled: "Encryption is not enabled",
  deleteTitle: "Delete note?",
  deleteBody: "This note will be removed on all your signed-in devices.",
  delete: "Delete",
  cancel: "Cancel",
};

const dict: Record<Lang, Keys> = { vi, en };

export function getLang(): Lang {
  const v = localStorage.getItem(KEY);
  return v === "en" ? "en" : "vi"; // default Vietnamese
}

export function setLang(l: Lang): void {
  localStorage.setItem(KEY, l);
  // notify same-window listeners (storage event only fires in other windows)
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: l }));
}

/** Translate a key. Reads the current language if one isn't passed (so it works
 *  outside React, e.g. native dialogs). */
export function t(key: keyof Keys, lang: Lang = getLang()): string {
  return dict[lang][key];
}

/** Reactive language hook; re-renders on change (incl. other windows). */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(getLang);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setLangState(e.newValue === "en" ? "en" : "vi");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [lang, setLang];
}
