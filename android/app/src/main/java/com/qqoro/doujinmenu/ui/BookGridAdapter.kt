package com.qqoro.doujinmenu.ui

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.drawable.toDrawable
import com.qqoro.doujinmenu.R
import com.qqoro.doujinmenu.data.SyncRepository
import com.qqoro.doujinmenu.data.local.BookEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class BookGridAdapter(
    private val scope: CoroutineScope,
    private val repository: SyncRepository,
    private val onFavoriteClick: (BookEntity) -> Unit,
) : BaseAdapter() {
    private var books: List<BookEntity> = emptyList()
    private val placeholder = Color.rgb(232, 229, 239).toDrawable()

    fun submitList(items: List<BookEntity>) {
        books = items
        notifyDataSetChanged()
    }

    override fun getCount(): Int = books.size

    override fun getItem(position: Int): BookEntity = books[position]

    override fun getItemId(position: Int): Long = books[position].syncId.hashCode().toLong()

    override fun hasStableIds(): Boolean = true

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val holder: ViewHolder
        val itemView: View
        if (convertView == null) {
            holder = createViewHolder(parent)
            itemView = holder.root.apply { tag = holder }
        } else {
            itemView = convertView
            holder = convertView.tag as ViewHolder
        }

        val book = getItem(position)
        holder.title.text = book.title
        holder.progress.text = parent.context.getString(
            R.string.reading_progress,
            book.currentPage,
            book.pageCount,
        )
        holder.favorite.setText(
            if (book.isFavorite) R.string.favorite_on else R.string.favorite_off,
        )
        holder.favorite.contentDescription = parent.context.getString(
            if (book.isFavorite) R.string.remove_favorite else R.string.add_favorite,
        )
        holder.favorite.setOnClickListener { onFavoriteClick(book) }

        holder.cover.tag = book.syncId
        holder.cover.setImageDrawable(placeholder)
        holder.cover.contentDescription = parent.context.getString(
            R.string.book_cover_description,
            book.title,
        )
        scope.launch {
            val bitmap = runCatching { repository.loadCover(book.syncId) }.getOrNull()
            if (holder.cover.tag == book.syncId && bitmap != null) {
                holder.cover.setImageBitmap(bitmap)
            }
        }
        return itemView
    }

    private fun createViewHolder(parent: ViewGroup): ViewHolder {
        val context = parent.context
        val padding = context.dp(8)
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = context.dp(12).toFloat()
                setStroke(context.dp(1), Color.rgb(225, 222, 230))
            }
        }
        val cover = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            adjustViewBounds = false
        }
        root.addView(
            cover,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                context.dp(220),
            ),
        )
        val title = TextView(context).apply {
            textSize = 15f
            maxLines = 2
            setTextColor(Color.rgb(35, 33, 40))
            setPadding(0, context.dp(8), 0, 0)
        }
        root.addView(title)
        val bottom = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val progress = TextView(context).apply {
            textSize = 12f
            setTextColor(Color.DKGRAY)
        }
        bottom.addView(
            progress,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        val favorite = Button(context).apply {
            minWidth = 0
            minimumWidth = 0
            setPadding(context.dp(8), 0, context.dp(8), 0)
        }
        bottom.addView(favorite)
        root.addView(bottom)
        return ViewHolder(root, cover, title, progress, favorite)
    }

    private data class ViewHolder(
        val root: LinearLayout,
        val cover: ImageView,
        val title: TextView,
        val progress: TextView,
        val favorite: Button,
    )
}

private fun android.content.Context.dp(value: Int): Int =
    (value * resources.displayMetrics.density).toInt()
