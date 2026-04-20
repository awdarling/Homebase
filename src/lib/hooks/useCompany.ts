'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface CompanyInfo {
  id: string
  name: string
  industry: string | null
  timezone: string
  onboarding_complete: boolean
}

interface UserInfo {
  id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  company_id: string
}

export function useCompany() {
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    fetchCompany()
  }, [])

  async function fetchCompany() {
    setLoading(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { setLoading(false); return }

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!userData) { setLoading(false); return }
    setUser(userData)

    const { data: companyData } = await supabase
      .from('companies')
      .select('*')
      .eq('id', userData.company_id)
      .single()

    if (companyData) setCompany(companyData)
    setLoading(false)
  }

  return { company, user, loading }
}