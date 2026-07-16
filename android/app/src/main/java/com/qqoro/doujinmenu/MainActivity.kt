package com.qqoro.doujinmenu

import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.qqoro.doujinmenu.data.SyncRepository
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var repository: SyncRepository
    private lateinit var addressInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var pairButton: Button
    private lateinit var syncButton: Button
    private lateinit var statusText: TextView
    private lateinit var libraryText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = (application as DoujinMenuApplication).repository
        setContentView(createContentView())
        syncButton.isEnabled = repository.hasConnection()
        observeLibrary()
    }

    private fun createContentView(): View {
        val density = resources.displayMetrics.density
        val padding = (24 * density).toInt()
        val spacing = (12 * density).toInt()
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }

        content.addView(TextView(this).apply {
            setText(R.string.sync_title)
            textSize = 24f
        })
        content.addView(TextView(this).apply {
            setText(R.string.sync_description)
            textSize = 15f
            setPadding(0, spacing, 0, spacing)
        })

        addressInput = EditText(this).apply {
            setHint(R.string.address_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        content.addView(addressInput, matchWidth())

        codeInput = EditText(this).apply {
            setHint(R.string.pairing_code_hint)
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
        }
        content.addView(codeInput, matchWidth())

        pairButton = Button(this).apply {
            setText(R.string.pair_and_sync)
            setOnClickListener { pair() }
        }
        content.addView(pairButton, matchWidth())

        syncButton = Button(this).apply {
            setText(R.string.sync_now)
            setOnClickListener { syncNow() }
        }
        content.addView(syncButton, matchWidth())

        statusText = TextView(this).apply {
            setText(if (repository.hasConnection()) R.string.paired else R.string.pairing_required)
            textSize = 16f
            setPadding(0, spacing, 0, spacing)
        }
        content.addView(statusText)

        libraryText = TextView(this).apply {
            text = getString(R.string.cached_book_count, 0)
            textSize = 16f
        }
        content.addView(libraryText)

        return ScrollView(this).apply { addView(content) }
    }

    private fun pair() {
        runOperation(getString(R.string.pairing_in_progress)) {
            repository.pair(
                addressInput.text.toString(),
                codeInput.text.toString(),
                Build.MODEL.ifBlank { "Android" },
            )
            syncButton.isEnabled = true
            codeInput.text.clear()
            statusText.setText(R.string.pairing_complete)
        }
    }

    private fun syncNow() {
        runOperation(getString(R.string.sync_in_progress)) {
            repository.syncNow()
            statusText.setText(R.string.sync_complete)
        }
    }

    private fun runOperation(message: String, operation: suspend () -> Unit) {
        pairButton.isEnabled = false
        syncButton.isEnabled = false
        statusText.text = message
        lifecycleScope.launch {
            runCatching { operation() }
                .onFailure { statusText.text = it.message ?: getString(R.string.operation_failed) }
            pairButton.isEnabled = true
            syncButton.isEnabled = repository.hasConnection()
        }
    }

    private fun observeLibrary() {
        lifecycleScope.launch {
            repository.observeBooks().collectLatest { books ->
                libraryText.text = getString(R.string.cached_book_count, books.size)
            }
        }
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )
}
