'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface QuriaDebugInfo {
  email: string | null
  rowFound: boolean
  error: string | null
}

let cache: boolean | null = null
let debugCache: QuriaDebugInfo | null = null

export function useQuria() {
  const [isQuria, setIsQuria] = useState(cache ?? false)
  const [loading, setLoading] = useState(cache === null)
  const [debug, setDebug] = useState<QuriaDebugInfo | null>(debugCache)

  useEffect(() => {
    if (cache !== null) {
      setIsQuria(cache)
      setLoading(false)
      setDebug(debugCache)
      return
    }

    async function check() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email ?? null
      console.log('[useQuria] checking email:', email)

      if (!email) {
        const info: QuriaDebugInfo = { email: null, rowFound: false, error: 'no auth user' }
        cache = false
        debugCache = info
        setIsQuria(false)
        setDebug(info)
        setLoading(false)
        console.log('[useQuria] no email — isQuria=false')
        return
      }

      const { data, error } = await supabase
        .from('quria_staff')
        .select('id, email, active')
        .eq('email', email)
        .eq('active', true)
        .limit(1)
        .maybeSingle()

      console.log('[useQuria] query result:', { data, error: error?.message })

      const found = !!data
      const info: QuriaDebugInfo = {
        email,
        rowFound: found,
        error: error?.message ?? null,
      }
      cache = found
      debugCache = info
      setIsQuria(found)
      setDebug(info)
      setLoading(false)
      console.log('[useQuria] final isQuria:', found)
    }

    check()
  }, [])

  return { isQuria, loading, debug }
}
