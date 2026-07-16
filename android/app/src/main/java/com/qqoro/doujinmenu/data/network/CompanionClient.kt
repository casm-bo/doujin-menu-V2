package com.qqoro.doujinmenu.data.network

import com.qqoro.doujinmenu.data.BootstrapPayload
import com.qqoro.doujinmenu.data.ChangesPayload
import com.qqoro.doujinmenu.data.MutationResult
import com.qqoro.doujinmenu.data.PairingResult
import com.qqoro.doujinmenu.data.PendingHistoryEvent
import com.qqoro.doujinmenu.data.PushPayload
import com.qqoro.doujinmenu.data.RemoteBook
import com.qqoro.doujinmenu.data.RemoteBookState
import com.qqoro.doujinmenu.data.RemoteHistoryEvent
import com.qqoro.doujinmenu.data.RemoteSyncChange
import com.qqoro.doujinmenu.data.SyncMutation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class CompanionClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    suspend fun pair(
        baseUrl: String,
        code: String,
        deviceName: String,
    ): PairingResult {
        val normalizedUrl = PrivateLanUrl.normalize(baseUrl)
        val body = JSONObject()
            .put("code", code)
            .put("deviceName", deviceName)
        val data = requestJson(normalizedUrl, "/v1/pair", null, "POST", body)
        val device = data.getJSONObject("device")
        return PairingResult(
            deviceId = device.getString("id"),
            deviceName = device.getString("name"),
            token = data.getString("token"),
        )
    }

    suspend fun listBooks(baseUrl: String, token: String): List<RemoteBook> {
        val data = requestJson(baseUrl, "/v1/library/books", token)
        return data.getJSONArray("itemsOrSelf").mapObjects(::parseLibraryBook)
    }

    suspend fun bootstrap(baseUrl: String, token: String): BootstrapPayload {
        val data = requestJson(baseUrl, "/v1/sync/bootstrap", token)
        return BootstrapPayload(
            cursor = data.getLong("cursor"),
            serverTime = data.getString("serverTime"),
            books = data.getJSONArray("books").mapObjects(::parseBookState),
            history = data.getJSONArray("history").mapObjects(::parseHistory),
        )
    }

    suspend fun getChanges(
        baseUrl: String,
        token: String,
        cursor: Long,
        limit: Int = 200,
    ): ChangesPayload {
        val data = requestJson(
            baseUrl,
            "/v1/sync/changes?cursor=$cursor&limit=$limit",
            token,
        )
        return ChangesPayload(
            cursor = data.getLong("cursor"),
            hasMore = data.getBoolean("hasMore"),
            changes = data.getJSONArray("changes").mapObjects { change ->
                RemoteSyncChange(
                    cursor = change.getLong("cursor"),
                    state = parseBookState(change.getJSONObject("state")),
                    historyEvent = change.optJSONObject("historyEvent")?.let(::parseHistory),
                )
            },
        )
    }

    suspend fun pushChanges(
        baseUrl: String,
        token: String,
        mutations: List<SyncMutation>,
    ): PushPayload {
        val mutationJson = JSONArray().apply {
            mutations.forEach { put(it.toJson()) }
        }
        val data = requestJson(
            baseUrl,
            "/v1/sync/changes",
            token,
            "POST",
            JSONObject().put("mutations", mutationJson),
        )
        return PushPayload(
            cursor = data.getLong("cursor"),
            serverTime = data.getString("serverTime"),
            results = data.getJSONArray("results").mapObjects { result ->
                MutationResult(
                    mutationId = result.getString("mutationId"),
                    status = result.getString("status"),
                    conflict = result.getBoolean("conflict"),
                    state = result.optJSONObject("state")?.let(::parseBookState),
                )
            },
        )
    }

    private suspend fun requestJson(
        baseUrl: String,
        path: String,
        token: String?,
        method: String = "GET",
        jsonBody: JSONObject? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val safeBaseUrl = PrivateLanUrl.normalize(baseUrl)
        val request = Request.Builder()
            .url(safeBaseUrl + path)
            .header("Accept", "application/json")
            .apply {
                if (token != null) header("Authorization", "Bearer $token")
                if (method == "POST") {
                    method(
                        "POST",
                        (jsonBody ?: JSONObject()).toString()
                            .toRequestBody(JSON_MEDIA_TYPE),
                    )
                }
            }
            .build()
        httpClient.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val envelope = runCatching { JSONObject(text) }.getOrElse {
                throw IOException("데스크톱에서 올바르지 않은 응답을 받았습니다.")
            }
            if (!response.isSuccessful || !envelope.optBoolean("success")) {
                throw IOException(envelope.optString("error", "요청에 실패했습니다."))
            }
            val data = envelope.opt("data")
            when (data) {
                is JSONObject -> data
                is JSONArray -> JSONObject().put("itemsOrSelf", data)
                else -> JSONObject()
            }
        }
    }

    private fun parseLibraryBook(json: JSONObject) = RemoteBook(
        remoteId = json.getLong("id"),
        syncId = json.getString("syncId"),
        title = json.getString("title"),
        pageCount = json.getInt("pageCount"),
        currentPage = json.getInt("currentPage"),
        isFavorite = json.getBoolean("isFavorite"),
        lastReadAt = json.nullableString("lastReadAt"),
        version = json.getLong("stateVersion"),
        updatedAt = json.nullableString("stateUpdatedAt"),
        coverUrl = json.getString("coverUrl"),
    )

    private fun parseBookState(json: JSONObject) = RemoteBookState(
        syncId = json.getString("syncId"),
        currentPage = json.getInt("currentPage"),
        isFavorite = json.getBoolean("isFavorite"),
        lastReadAt = json.nullableString("lastReadAt"),
        version = json.getLong("version"),
        updatedAt = json.nullableString("updatedAt"),
    )

    private fun parseHistory(json: JSONObject) = RemoteHistoryEvent(
        eventId = json.getString("eventId"),
        bookSyncId = json.getString("bookSyncId"),
        viewedAt = json.getString("viewedAt"),
        currentPage = if (json.isNull("currentPage")) null else json.getInt("currentPage"),
        deviceId = json.getString("deviceId"),
    )

    private fun SyncMutation.toJson(): JSONObject = JSONObject()
        .put("mutationId", mutationId)
        .put("bookSyncId", bookSyncId)
        .put("baseVersion", baseVersion)
        .apply {
            currentPage?.let { put("currentPage", it) }
            isFavorite?.let { put("isFavorite", it) }
            historyEvent?.let { put("historyEvent", it.toJson()) }
        }

    private fun PendingHistoryEvent.toJson(): JSONObject = JSONObject()
        .put("eventId", eventId)
        .put("viewedAt", viewedAt)
        .apply { currentPage?.let { put("currentPage", it) } }

    private fun JSONObject.nullableString(key: String): String? =
        if (isNull(key) || !has(key)) null else getString(key)

    private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
        List(length()) { index -> transform(getJSONObject(index)) }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
