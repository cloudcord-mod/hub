package io.github.revenge.xposed

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.app.ApplicationExitInfo
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.view.KeyEvent
import android.view.Window
import android.widget.Toast
import io.github.revenge.xposed.modules.UpdaterModule
import java.text.DateFormat
import java.util.Date

/** Recovery entry point that does not depend on React Native or the runtime. */
internal object CloudCordRecovery {
    fun attach(activity: Activity) {
        val window = activity.window ?: return
        fun wrapCallback() {
            val callback = window.callback ?: return
            if (callback !is RecoveryCallback) window.callback = RecoveryCallback(activity, callback)
        }
        wrapCallback()
        // Discord can replace the callback after onCreate while setting up its window.
        window.decorView.viewTreeObserver.addOnWindowFocusChangeListener { focused ->
            if (focused) wrapCallback()
        }
    }

    private class RecoveryCallback(
        private val activity: Activity,
        private val delegate: Window.Callback,
    ) : Window.Callback by delegate {
        private var openedForPress = false
        private var pressStartedAt: Long? = null

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.keyCode == KeyEvent.KEYCODE_VOLUME_UP && event.action == KeyEvent.ACTION_DOWN) {
                if (event.repeatCount == 0) {
                    openedForPress = false
                    pressStartedAt = event.eventTime
                } else if (!openedForPress && (event.isLongPress || event.eventTime - event.downTime >= 1200)) {
                    openRecovery()
                }
            } else if (event.keyCode == KeyEvent.KEYCODE_VOLUME_UP && event.action == KeyEvent.ACTION_UP) {
                // Some Android 9 inputs report only down and up, with no repeat or long-press flag.
                val start = pressStartedAt
                pressStartedAt = null
                if (!openedForPress && !event.isCanceled && start != null && event.eventTime - start >= 1000) {
                    openRecovery()
                }
            }
            return delegate.dispatchKeyEvent(event)
        }

        private fun openRecovery() {
            openedForPress = true
            activity.window.decorView.post {
                if (activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) return@post
                val dialog = AlertDialog.Builder(activity)
                    .setTitle("CloudCord recovery")
                    .setMessage("Download a verified CloudCord update without reinstalling Discord.")
                    .setNegativeButton(android.R.string.cancel, null)
                    .setPositiveButton("Download update") { _, _ ->
                        UpdaterModule.downloadScript(activity, officialOnly = true)
                    }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    dialog.setNeutralButton("Last app exit") { _, _ -> showLastExit() }
                }
                dialog.show()
            }
        }

        private fun showLastExit() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
            val exit = runCatching {
                activity.getSystemService(ActivityManager::class.java)
                    ?.getHistoricalProcessExitReasons(activity.packageName, 0, 1)
                    ?.firstOrNull()
            }.getOrNull()
            val dialog = AlertDialog.Builder(activity)
                .setTitle("Last CloudCord app exit")
                .setNegativeButton(android.R.string.cancel, null)
            if (exit == null) {
                dialog.setMessage("Android has no recent exit information for CloudCord.").show()
                return
            }
            val reason = when (exit.reason) {
                ApplicationExitInfo.REASON_CRASH -> "App crash"
                ApplicationExitInfo.REASON_CRASH_NATIVE -> "Native crash"
                ApplicationExitInfo.REASON_ANR -> "App did not respond"
                ApplicationExitInfo.REASON_LOW_MEMORY -> "Low memory"
                ApplicationExitInfo.REASON_SIGNALED -> "Process killed by a signal"
                ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "Excessive resource use"
                ApplicationExitInfo.REASON_USER_REQUESTED -> "App closed by user or system settings"
                ApplicationExitInfo.REASON_EXIT_SELF -> "App exited on its own"
                else -> "Other Android exit"
            }
            val time = DateFormat.getDateTimeInstance().format(Date(exit.timestamp))
            val report = "$time\n$reason (reason ${exit.reason}, status ${exit.status})\n" +
                "Android ${Build.VERSION.RELEASE}\nLast reported memory: ${exit.rss} kB RSS"
            dialog.setMessage(report)
                .setPositiveButton("Copy report") { _, _ ->
                    val clipboard = activity.getSystemService(ClipboardManager::class.java)
                    if (clipboard != null) {
                        clipboard.setPrimaryClip(ClipData.newPlainText("CloudCord app exit", report))
                        Toast.makeText(activity, "Exit report copied", Toast.LENGTH_SHORT).show()
                    }
                }
                .show()
        }
    }
}
