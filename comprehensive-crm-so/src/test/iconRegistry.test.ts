import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import * as Phosphor from '@phosphor-icons/react'
import { getIcon, validateIconName, listRegisteredIcons } from '@/lib/iconRegistry'

describe('iconRegistry', () => {
    it('resolves known aliases to valid components', () => {
        const MoneyIcon = getIcon('revenue')
        const FunnelIcon = getIcon('funnel')
        // Should be renderable React components (function or forwardRef objects)
        const r1 = render(React.createElement(MoneyIcon))
        expect(r1.container.querySelector('svg')).toBeTruthy()
        r1.unmount()
        const r2 = render(React.createElement(FunnelIcon))
        expect(r2.container.querySelector('svg')).toBeTruthy()
        r2.unmount()
    })

    it('validates known icon names and aliases', () => {
        expect(validateIconName('currency')).toBe(true)
        expect(validateIconName('CalendarBlank')).toBe(true)
        expect(validateIconName('nonexistent-icon')).toBe(false)
    })

    it('falls back to Question for unknown icons', () => {
        const Unknown = getIcon('definitely-unknown')
        expect(Unknown).toBe((Phosphor as any).Question)
    })

    it('lists registered aliases', () => {
        const list = listRegisteredIcons()
        expect(Array.isArray(list)).toBe(true)
        expect(list.length).toBeGreaterThan(0)
    })
})
