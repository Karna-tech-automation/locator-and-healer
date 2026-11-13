import type { LocatorDescriptor } from './types';

export function parseLocatorString(code: string): LocatorDescriptor {
  const clean = code.replace(/^page\./, '').replace(/^await\s+/, '').trim();

  if (clean.includes('getByRole(')) {
    const roleMatch = clean.match(/getByRole\(['"](.+?)['"]/);
    const nameMatch = clean.match(/["']?name["']?\s*:\s*['"](.+?)['"]/);
    return { kind: 'role', role: roleMatch?.[1] || 'button', name: nameMatch?.[1] || '' };
  }
  if (clean.includes('getByText(')) return { kind: 'text', value: clean.match(/getByText\(['"](.+?)['"]/)?.[1] || '' };
  if (clean.includes('getByLabel(')) return { kind: 'label', value: clean.match(/getByLabel\(['"](.+?)['"]/)?.[1] || '' };
  if (clean.includes('getByPlaceholder(')) return { kind: 'placeholder', value: clean.match(/getByPlaceholder\(['"](.+?)['"]/)?.[1] || '' };
  if (clean.includes('getByTestId(')) return { kind: 'testId', value: clean.match(/getByTestId\(['"](.+?)['"]/)?.[1] || '' };

  if (clean.includes('locator(')) {
    const match = clean.match(/locator\(['"](.+?)['"]\)/);
    if (match && match[1]) {
      let val = match[1];
      if (val.startsWith('css=')) val = val.replace('css=', '');
      if (val.startsWith('xpath=')) return { kind: 'xpath', value: val.replace('xpath=', '') };
      return { kind: 'css', value: val };
    }
  }

  return { kind: 'css', value: clean };
}

export function descriptorToCode(desc: LocatorDescriptor): string {
  switch (desc.kind) {
    case 'role': return `page.getByRole('${desc.role}', { name: '${desc.name}' })`;
    case 'label': return `page.getByLabel('${desc.value}')`;
    case 'placeholder': return `page.getByPlaceholder('${desc.value}')`;
    case 'text': return `page.getByText('${desc.value}')`;
    case 'altText': return `page.getByAltText('${desc.value}')`;
    case 'title': return `page.getByTitle('${desc.value}')`;
    case 'testId': return `page.getByTestId('${desc.value}')`;
    case 'css': return `page.locator('${desc.value}')`;
    case 'xpath': return `page.locator('xpath=${desc.value}')`;
    default: return 'Unknown Locator';
  }
}