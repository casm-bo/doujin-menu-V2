package com.qqoro.doujinmenu.data.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivateLanUrlTest {
    @Test
    fun `normalizes private addresses with the companion default port`() {
        assertEquals(
            "http://192.168.0.15:47831",
            PrivateLanUrl.normalize("192.168.0.15"),
        )
        assertEquals(
            "http://10.0.0.2:50000",
            PrivateLanUrl.normalize("http://10.0.0.2:50000/"),
        )
    }

    @Test
    fun `accepts all supported private ipv4 ranges`() {
        assertTrue(PrivateLanUrl.isPrivateIpv4("10.0.0.1"))
        assertTrue(PrivateLanUrl.isPrivateIpv4("172.16.0.1"))
        assertTrue(PrivateLanUrl.isPrivateIpv4("172.31.255.255"))
        assertTrue(PrivateLanUrl.isPrivateIpv4("192.168.1.1"))
        assertTrue(PrivateLanUrl.isPrivateIpv4("127.0.0.1"))
    }

    @Test
    fun `rejects public hosts and non-http schemes`() {
        assertThrows(IllegalArgumentException::class.java) {
            PrivateLanUrl.normalize("8.8.8.8")
        }
        assertThrows(IllegalArgumentException::class.java) {
            PrivateLanUrl.normalize("https://192.168.0.15")
        }
        assertThrows(IllegalArgumentException::class.java) {
            PrivateLanUrl.normalize("example.com")
        }
    }
}
