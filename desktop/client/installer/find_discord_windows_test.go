package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestDiscordInstallProcess(t *testing.T) {
	const root = `C:\Users\tester\AppData\Local\Discord`
	for _, test := range []struct {
		executable string
		match      bool
	}{
		{root + `\app-1.0.9268\Discord.exe`, true},
		{`c:\users\TESTER\appdata\local\discord\APP-1.0.9000\discord.EXE`, true},
		{root + `\app-1.0.9268\DiscordCanary.exe`, false},
		{root + `\1.0.9268\Discord.exe`, false},
		{root + `\app-not-a-version\Discord.exe`, false},
		{root + `-dev\app-1.0.9268\Discord.exe`, false},
		{`C:\development\Discord\app-1.0.9268\Discord.exe`, false},
	} {
		if got := isDiscordInstallProcess(root, "Discord.exe", test.executable); got != test.match {
			t.Errorf("%s matched %v, want %v", test.executable, got, test.match)
		}
	}
}

func TestPreparePatchClosesOnlySelectedInstallation(t *testing.T) {
	const fixture = "CLOUDCORD_TEST_WAIT_AS_DISCORD"
	if os.Getenv(fixture) == "1" {
		time.Sleep(time.Minute)
		return
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	makeInstall := func(root string) string {
		t.Helper()
		version := filepath.Join(root, "app-1.0.9268")
		if err := os.MkdirAll(version, 0755); err != nil {
			t.Fatal(err)
		}
		image := filepath.Join(version, "Discord.exe")
		if err := os.WriteFile(image, binary, 0755); err != nil {
			t.Fatal(err)
		}
		return image
	}
	start := func(image string) <-chan error {
		t.Helper()
		command := exec.Command(image, "-test.run", "^TestPreparePatchClosesOnlySelectedInstallation$")
		command.Env = append(os.Environ(), fixture+"=1")
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		exited := make(chan error, 1)
		go func() { exited <- command.Wait(); close(exited) }()
		t.Cleanup(func() { _ = command.Process.Kill(); <-exited })
		return exited
	}
	other := start(makeInstall(t.TempDir()))
	selected := t.TempDir()
	// A second process sharing the selected executable path mimics Electron's helpers.
	image := makeInstall(selected)
	targets := []<-chan error{start(image), start(image)}
	PreparePatch(&DiscordInstall{path: selected, branch: "stable"})
	for _, exited := range targets {
		select {
		case err := <-exited:
			if err != nil {
				t.Fatalf("fixture did not exit through installer: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("selected Discord process is still running")
		}
	}
	select {
	case err := <-other:
		t.Fatalf("installer closed another Discord installation: %v", err)
	default:
	}
}
