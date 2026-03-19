'use client'

import { useState, useEffect } from 'react'
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function generateData() {
  return MONTHS.map((name) => ({
    name,
    total: Math.floor(Math.random() * 20) + 5,
  }))
}

export function SignupsChart() {
  const [data, setData] = useState<{ name: string; total: number }[]>([])

  useEffect(() => {
    setData(generateData())
  }, [])

  if (data.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data}>
        <XAxis
          dataKey="name"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <Line type="monotone" dataKey="total" stroke="#adfa1d" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  )
}
