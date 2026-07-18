package com.casm.doujinmenu

import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.GridView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.casm.doujinmenu.data.SyncRepository
import com.casm.doujinmenu.data.local.BookEntity
import com.casm.doujinmenu.ui.BookGridAdapter
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var repository: SyncRepository
    private lateinit var connectionPanel: LinearLayout
    private lateinit var libraryPanel: LinearLayout
    private lateinit var addressInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var pairButton: Button
    private lateinit var syncButton: Button
    private lateinit var statusText: TextView
    private lateinit var libraryText: TextView
    private lateinit var searchInput: EditText
    private lateinit var favoriteOnly: CheckBox
    private lateinit var sortSpinner: Spinner
    private lateinit var gridAdapter: BookGridAdapter
    private var allBooks: List<BookEntity> = emptyList()
    private var connectionState = ConnectionState.DISCONNECTED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = (application as DoujinMenuApplication).repository
        gridAdapter = BookGridAdapter(lifecycleScope, repository, ::toggleFavorite)
        setContentView(createContentView())
        val registered = repository.hasConnection()
        setRegisteredUi(registered)
        setConnectionState(if (registered) ConnectionState.CONNECTING else ConnectionState.DISCONNECTED)
        observeLibrary()
        observeConnection()
    }

    private fun createContentView(): View {
        val padding = dp(16)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(0xFFF8F7FA.toInt())
        }
        root.addView(TextView(this).apply {
            setText(R.string.sync_title)
            textSize = 24f
        })

        statusText = TextView(this).apply {
            textSize = 15f
            setPadding(0, dp(8), 0, dp(8))
        }
        root.addView(statusText)

        connectionPanel = createConnectionPanel()
        root.addView(connectionPanel)

        libraryPanel = createLibraryPanel()
        root.addView(
            libraryPanel,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )
        return root
    }

    private fun createConnectionPanel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        addView(TextView(this@MainActivity).apply {
            setText(R.string.sync_description)
            textSize = 15f
            setPadding(0, dp(12), 0, dp(8))
        })
        addressInput = EditText(this@MainActivity).apply {
            setHint(R.string.address_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        addView(addressInput, matchWidth())
        codeInput = EditText(this@MainActivity).apply {
            setHint(R.string.pairing_code_hint)
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
        }
        addView(codeInput, matchWidth())
        pairButton = Button(this@MainActivity).apply {
            setText(R.string.pair_and_sync)
            setOnClickListener { pair() }
        }
        addView(pairButton, matchWidth())
    }

    private fun createLibraryPanel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        val actionRow = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        syncButton = Button(this@MainActivity).apply {
            setText(R.string.sync_now)
            setOnClickListener { syncNow() }
        }
        actionRow.addView(syncButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        actionRow.addView(Button(this@MainActivity).apply {
            setText(R.string.disconnect)
            setOnClickListener {
                repository.disconnect()
                setRegisteredUi(false)
                setConnectionState(ConnectionState.DISCONNECTED)
            }
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        addView(actionRow)

        addView(TextView(this@MainActivity).apply {
            setText(R.string.registered_pc)
            textSize = 18f
            setPadding(0, dp(8), 0, dp(4))
        })
        libraryText = TextView(this@MainActivity).apply { textSize = 15f }
        addView(libraryText)

        searchInput = EditText(this@MainActivity).apply {
            setHint(R.string.search_library)
            setSingleLine(true)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = applyFilters()
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        addView(searchInput, matchWidth())

        val filterRow = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        favoriteOnly = CheckBox(this@MainActivity).apply {
            setText(R.string.favorite_only)
            setOnCheckedChangeListener { _, _ -> applyFilters() }
        }
        filterRow.addView(favoriteOnly, LinearLayout.LayoutParams(0, dp(48), 1f))
        sortSpinner = Spinner(this@MainActivity).apply {
            adapter = ArrayAdapter.createFromResource(
                this@MainActivity,
                R.array.library_sort_options,
                android.R.layout.simple_spinner_dropdown_item,
            )
            onItemSelectedListener = SimpleItemSelectedListener { applyFilters() }
        }
        filterRow.addView(sortSpinner, LinearLayout.LayoutParams(0, dp(48), 1f))
        addView(filterRow)

        addView(GridView(this@MainActivity).apply {
            numColumns = if (resources.configuration.screenWidthDp >= 600) 4 else 2
            horizontalSpacing = dp(10)
            verticalSpacing = dp(10)
            stretchMode = GridView.STRETCH_COLUMN_WIDTH
            clipToPadding = false
            setPadding(0, dp(8), 0, dp(16))
            adapter = gridAdapter
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f,
        ))
    }

    private fun pair() {
        runOperation(getString(R.string.pairing_in_progress)) {
            repository.pair(
                addressInput.text.toString(),
                codeInput.text.toString(),
                Build.MODEL.ifBlank { "Android" },
            )
            codeInput.text.clear()
            setRegisteredUi(true)
            setConnectionState(ConnectionState.CONNECTED)
        }
    }

    private fun syncNow() {
        runOperation(getString(R.string.sync_in_progress)) {
            repository.syncNow()
            setConnectionState(ConnectionState.CONNECTED)
        }
    }

    private fun toggleFavorite(book: BookEntity) {
        lifecycleScope.launch {
            repository.setFavorite(book.syncId, !book.isFavorite)
            statusText.setText(R.string.change_queued)
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
                allBooks = books
                applyFilters()
            }
        }
    }

    private fun observeConnection() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    if (repository.hasConnection()) {
                        if (connectionState != ConnectionState.CONNECTED) {
                            setConnectionState(ConnectionState.CONNECTING)
                        }
                        runCatching { repository.checkConnection() }
                            .onSuccess { setConnectionState(ConnectionState.CONNECTED) }
                            .onFailure { setConnectionState(ConnectionState.DISCONNECTED) }
                    }
                    delay(CONNECTION_CHECK_INTERVAL_MS)
                }
            }
        }
    }

    private fun applyFilters() {
        val query = searchInput.text?.toString()?.trim().orEmpty()
        var filtered = allBooks.asSequence()
        if (query.isNotEmpty()) {
            filtered = filtered.filter { it.title.contains(query, ignoreCase = true) }
        }
        if (favoriteOnly.isChecked) filtered = filtered.filter { it.isFavorite }
        val sorted = when (sortSpinner.selectedItemPosition) {
            1 -> filtered.sortedByDescending { it.lastReadAt.orEmpty() }
            2 -> filtered.sortedByDescending { it.currentPage.toDouble() / maxOf(1, it.pageCount) }
            else -> filtered.sortedBy { it.title.lowercase() }
        }.toList()
        gridAdapter.submitList(sorted)
        libraryText.text = getString(R.string.library_book_count, sorted.size, allBooks.size)
    }

    private fun setRegisteredUi(registered: Boolean) {
        connectionPanel.visibility = if (registered) View.GONE else View.VISIBLE
        libraryPanel.visibility = if (registered) View.VISIBLE else View.GONE
        syncButton.isEnabled = registered
    }

    private fun setConnectionState(state: ConnectionState) {
        connectionState = state
        statusText.setText(
            when (state) {
                ConnectionState.CONNECTING -> R.string.connection_connecting
                ConnectionState.CONNECTED -> R.string.connection_connected
                ConnectionState.DISCONNECTED -> R.string.connection_disconnected
            },
        )
        syncButton.isEnabled = state == ConnectionState.CONNECTED
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val CONNECTION_CHECK_INTERVAL_MS = 3_000L
    }
}

private enum class ConnectionState { CONNECTING, CONNECTED, DISCONNECTED }

private class SimpleItemSelectedListener(
    private val onSelected: () -> Unit,
) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) = onSelected()
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
}
