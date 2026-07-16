package com.qqoro.doujinmenu.data.network

import java.net.URI

object PrivateLanUrl {
    const val DEFAULT_PORT = 47831

    fun normalize(input: String): String {
        val candidate = input.trim().let {
            if (it.startsWith("http://", ignoreCase = true)) it else "http://$it"
        }
        val uri = runCatching { URI(candidate) }
            .getOrElse { throw IllegalArgumentException("올바른 데스크톱 주소를 입력하세요.") }
        require(uri.scheme.equals("http", ignoreCase = true)) {
            "내부 동기화는 HTTP 주소만 지원합니다."
        }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "주소에는 호스트와 포트만 입력하세요."
        }
        require(uri.path.isNullOrEmpty() || uri.path == "/") {
            "주소에는 경로를 포함할 수 없습니다."
        }
        val host = uri.host ?: throw IllegalArgumentException("IPv4 주소를 입력하세요.")
        require(isPrivateIpv4(host)) {
            "10.x, 172.16-31.x, 192.168.x 대역의 내부 IPv4 주소만 허용됩니다."
        }
        val port = if (uri.port == -1) DEFAULT_PORT else uri.port
        require(port in 1..65535) { "올바른 포트를 입력하세요." }
        return "http://$host:$port"
    }

    fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split('.').map { it.toIntOrNull() ?: return false }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 ||
            parts[0] == 127 ||
            (parts[0] == 172 && parts[1] in 16..31) ||
            (parts[0] == 192 && parts[1] == 168)
    }
}
