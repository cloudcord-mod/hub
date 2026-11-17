/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Installer, a cross platform gui/cli app for installing Vencord
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

package main

import (
	"errors"
	"os"
	path "path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var windowsNames = map[string]string{
	"stable": "Discord",
	"ptb":    "DiscordPTB",
	"canary": "DiscordCanary",
	"dev":    "DiscordDevelopment",
}

var killLock sync.Mutex

func ParseDiscordNew(p, branch string, isFlatpak bool) *DiscordInstall {
	return nil
}

func ParseDiscord(p, branch string) *DiscordInstall {
	entries, err := os.ReadDir(p)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			Log.Warn("Error during readdir "+p+":", err)
		}
		return nil
	}

	isPatched := false
	appPath := ""
	var latestVer []int
	for _, dir := range entries {
		if !dir.IsDir() || !strings.HasPrefix(dir.Name(), "app-") {
			continue
		}
		resources := path.Join(p, dir.Name(), "resources")
		if !ExistsFile(resources) {
			continue
		}
		dirIsPatched := ExistsFile(path.Join(resources, "_app.asar"))
		if !dirIsPatched && !ExistsFile(path.Join(resources, "app.asar")) {
			continue
		}
		ver := ParseAppVersion(dir.Name())
		if ver == nil {
			continue
		}
		if appPath == "" || CompareAppVersion(ver, latestVer) > 0 {
			appPath = path.Join(resources, "app")
			isPatched = dirIsPatched
			latestVer = ver
		}
	}

	if appPath == "" {
		return nil
	}

	if branch == "" {
		branch = GetBranch(p)
	}

	return &DiscordInstall{
		path:             p,
		branch:           branch,
		appPath:          appPath,
		isPatched:        isPatched,
		isFlatpak:        false,
		isSystemElectron: false,
	}
}

func FindDiscords() []any {
	var discords []any

	appData := os.Getenv("LOCALAPPDATA")
	if appData == "" {
		Log.Error("%LOCALAPPDATA% is empty???????")
		return discords
	}

	for branch, dirname := range windowsNames {
		p := path.Join(appData, dirname)
		if discord := ParseDiscord(p, branch); discord != nil {
			Log.Debug("Found Discord install at ", p)
			discords = append(discords, discord)
		}
	}
	return discords
}

func PreparePatch(di *DiscordInstall) {
	killLock.Lock()
	defer killLock.Unlock()

	root, err := path.Abs(di.path)
	if err != nil {
		Log.Warn("Could not resolve Discord installation path:", err)
		return
	}
	if resolved, err := path.EvalSymlinks(root); err == nil {
		root = resolved
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		Log.Warn("Could not enumerate Discord processes:", err)
		return
	}
	defer windows.CloseHandle(snapshot)

	name := windowsNames[di.branch] + ".exe"
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	var stopped []windows.Handle
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		if !strings.EqualFold(windows.UTF16ToString(entry.ExeFile[:]), name) {
			continue
		}
		handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE|windows.SYNCHRONIZE, false, entry.ProcessID)
		if err != nil {
			continue
		}
		var executable [32768]uint16
		size := uint32(len(executable))
		if windows.QueryFullProcessImageName(handle, 0, &executable[0], &size) == nil &&
			isDiscordInstallProcess(root, name, windows.UTF16ToString(executable[:size])) && windows.TerminateProcess(handle, 0) == nil {
			stopped = append(stopped, handle)
		} else {
			_ = windows.CloseHandle(handle)
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for _, handle := range stopped {
		if remaining := time.Until(deadline); remaining > 0 {
			_, _ = windows.WaitForSingleObject(handle, uint32(remaining.Milliseconds()))
		}
		_ = windows.CloseHandle(handle)
	}
}

func isDiscordInstallProcess(root, name, executable string) bool {
	if !strings.EqualFold(path.Base(executable), name) {
		return false
	}
	versionDir := path.Dir(executable)
	version := strings.ToLower(path.Base(versionDir))
	if !strings.HasPrefix(version, "app-") || ParseAppVersion(version) == nil {
		return false
	}
	processRoot := path.Dir(versionDir)
	if strings.EqualFold(processRoot, root) {
		return true
	}
	// Windows can report the long path for a process started through a short
	// path or a junction. Compare directory identity when paths differ.
	selected, selectedErr := os.Stat(root)
	running, runningErr := os.Stat(processRoot)
	return selectedErr == nil && runningErr == nil && os.SameFile(selected, running)
}

func FixOwnership(_ string) error {
	return nil
}

// https://github.com/Vencord/Installer/issues/9

func CheckScuffedInstall() bool {
	username := os.Getenv("USERNAME")
	programData := os.Getenv("PROGRAMDATA")
	for _, discordName := range windowsNames {
		if ExistsFile(path.Join(programData, username, discordName)) {
			HandleScuffedInstall()
			return true
		}
	}
	return false
}
