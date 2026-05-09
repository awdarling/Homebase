'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Module-level cache: persists for the lifetime of the browser session (until page refresh).
// Avoids redundant Supabase round-trips when multiple components call this hook.
let cache: boolean | null = null

export function useQuria() {
  const [isQuria, setIsQuria] = useState(cache ?? false)
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    if (cache !== null) {
      setIsQuria(cache)
      setLoading(false)
      return
    }

    async function check() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) {
        cache = false
        setIsQuria(false)
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('quria_staff')
        .select('id')
        .eq('email', user.email)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      cache = data !== null
      setIsQuria(cache)
      setLoading(false)
    }

    check()
  }, [])

  return { isQuria, loading }
}
