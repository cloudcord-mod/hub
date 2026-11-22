/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Installer, a cross platform gui/cli app for installing Vencord
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sinlotl/buildinfo"
	"strings"
	"time"
)

var regexpReleaseRevision = regexp.MustCompile(`^[0-9a-f]{40}$`)
var IsSelfOutdated = false
var SelfUpdateCheckDoneChan = make(chan bool, 1)

func init() {
	//goland:noinspection GoBoolExpressions
	if buildinfo.InstallerTag == buildinfo.VersionUnknown {
		Log.Debug("Disabling self updater as this is not a release build")
		return
	}

	go DeleteOldExecutable()

	go func() {
		Log.Debug("Checking for Installer Updates...")

		releaseURL := InstallerReleaseUrl
		if runtime.GOOS == "windows" {
			releaseURL = ReleaseUrl
		}
		res, err := GetGithubRelease(releaseURL, InstallerReleaseUrlFallback)
		if err != nil {
			Log.Warn("Failed to check for self updates:", err)
			SelfUpdateCheckDoneChan <- false
		} else {
			IsSelfOutdated = res.TagName != buildinfo.InstallerTag
			if runtime.GOOS == "windows" {
				revision := res.Name[strings.LastIndex(res.Name, " ")+1:]
				IsSelfOutdated = regexpReleaseRevision.MatchString(revision) && revision != buildinfo.InstallerGitHash
			}
			Log.Debug("Is self outdated?", IsSelfOutdated)
			SelfUpdateCheckDoneChan <- true
		}
	}()
}

func GetInstallerDownloadLink() string {
	const BaseUrl = "https://github.com/cloudcord-mod/release-hub/releases/latest/download/"
	switch runtime.GOOS {
	case "windows":
		if IsTestBuild {
			return desktopDownloads + testDesktopTag + "/CloudCordSetup-Test.exe"
		}
		return desktopDownloads + stableDesktopTag + "/CloudCordSetup.exe"
	case "darwin":
		switch runtime.GOARCH {
		case "amd64":
			return BaseUrl + "CloudCordSetup-darwin-x64.zip"
		case "arm64":
			return BaseUrl + "CloudCordSetup-darwin-arm64.zip"
		default:
			return ""
		}
	case "linux":
		return BaseUrl + "CloudCordSetupCli-linux"
	default:
		return ""
	}
}

func CanUpdateSelf() bool {
	//goland:noinspection GoBoolExpressions
	return IsSelfOutdated && runtime.GOOS != "darwin"
}

func UpdateSelf() error {
	if !CanUpdateSelf() {
		return errors.New("Cannot update self. Either no update available or macos")
	}

	url := GetInstallerDownloadLink()
	if url == "" {
		return errors.New("Failed to get installer download link")
	}

	Log.Debug("Updating self from", url)

	ownExePath, err := os.Executable()
	if err != nil {
		return err
	}

	ownExeDir := filepath.Dir(ownExePath)

	res, err := runtimeClient.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("installer download failed: %s", res.Status)
	}

	tmp, err := os.CreateTemp(ownExeDir, "CloudCordSetupUpdate")
	if err != nil {
		return fmt.Errorf("Failed to create tempfile: %w", err)
	}
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}()
	if err = tmp.Chmod(0o755); err != nil {
		return fmt.Errorf("failed to chmod 755 %s: %w", tmp.Name(), err)
	}

	const maxInstallerSize = 128 << 20
	written, err := io.Copy(tmp, io.LimitReader(res.Body, maxInstallerSize+1))
	if err != nil {
		return err
	}
	if written == 0 || written > maxInstallerSize || (res.ContentLength >= 0 && written != res.ContentLength) {
		return fmt.Errorf("incomplete installer download: received %d bytes", written)
	}

	if err = tmp.Close(); err != nil {
		return err
	}

	backup := ownExePath + ".old"
	if err = os.Rename(ownExePath, backup); err != nil {
		return fmt.Errorf("could not back up the current installer: %w", err)
	}
	if err = os.Rename(tmp.Name(), ownExePath); err != nil {
		return errors.Join(fmt.Errorf("could not replace the installer: %w", err), os.Rename(backup, ownExePath))
	}

	return nil
}

func DeleteOldExecutable() {
	ownExePath, err := os.Executable()
	if err != nil {
		return
	}

	for attempts := 0; attempts < 10; attempts += 1 {
		err = os.Remove(ownExePath + ".old")

		if err == nil || errors.Is(err, os.ErrNotExist) {
			break
		}

		Log.Warn("Failed to remove old executable. Retrying in 1 second.", err)
		time.Sleep(1 * time.Second)
	}
}

func RelaunchSelf() error {
	attr := new(os.ProcAttr)
	attr.Files = []*os.File{os.Stdin, os.Stdout, os.Stderr}

	var argv []string
	if len(os.Args) > 1 {
		argv = os.Args[1:]
	} else {
		argv = []string{}
	}

	Log.Debug("Restarting self with exe", os.Args[0], "and args", argv)

	proc, err := os.StartProcess(os.Args[0], argv, attr)
	if err != nil {
		return fmt.Errorf("Failed to start new process: %w", err)
	}

	if err = proc.Release(); err != nil {
		return fmt.Errorf("Failed to release new process: %w", err)
	}

	os.Exit(0)
	return nil
}
