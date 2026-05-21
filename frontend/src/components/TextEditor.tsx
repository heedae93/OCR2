'use client'

import { useState, useRef, useEffect } from 'react'

interface TextElement {
  id: string
  x: number
  y: number
  text: string
  fontSize: number
  color: string
  fontFamily: string
}

interface TextEditorProps {
  isActive: boolean
  onTextAdd: (element: TextElement) => void
  pageWidth: number
  pageHeight: number
  elements: TextElement[]
  onElementUpdate: (id: string, updates: Partial<TextElement>) => void
  onElementDelete: (id: string) => void
}

export default function TextEditor({
  isActive,
  onTextAdd,
  pageWidth,
  pageHeight,
  elements,
  onElementUpdate,
  onElementDelete
}: TextEditorProps) {
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editingText, setEditingText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const newElement: TextElement = {
      id: `text-${Date.now()}`,
      x,
      y,
      text: '텍스트 입력',
      fontSize: 16,
      color: '#000000',
      fontFamily: 'Arial'
    }

    onTextAdd(newElement)
    setSelectedElement(newElement.id)
    setIsEditing(true)
    setEditingText(newElement.text)
  }

  const handleElementClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!isActive) return

    setSelectedElement(id)
    const element = elements.find(el => el.id === id)
    if (element) {
      setIsEditing(true)
      setEditingText(element.text)
    }
  }

  const handleTextChange = (text: string) => {
    setEditingText(text)
    if (selectedElement) {
      onElementUpdate(selectedElement, { text })
    }
  }

  const handleBlur = () => {
    setIsEditing(false)
  }

  if (!isActive && elements.length === 0) return null;

  return (
    <div
      className="absolute inset-0"
      style={{ width: pageWidth, height: pageHeight, pointerEvents: isActive ? "auto" : "none" }}
      onClick={isActive ? handleClick : undefined}
    >
      {elements.map((element) => (
        <div
          key={element.id}
          onClick={(e) => handleElementClick(e, element.id)}
          className={`absolute cursor-move ${
            selectedElement === element.id ? 'ring-2 ring-primary' : ''
          }`}
          style={{
            left: element.x,
            top: element.y,
            fontSize: element.fontSize,
            color: element.color,
            fontFamily: element.fontFamily
          }}
        >
          {isEditing && selectedElement === element.id ? (
            <input
              ref={inputRef}
              type="text"
              value={editingText}
              onChange={(e) => handleTextChange(e.target.value)}
              onBlur={handleBlur}
              className="bg-transparent border-none outline-none"
              style={{
                fontSize: element.fontSize,
                color: element.color,
                fontFamily: element.fontFamily,
                width: `${Math.max(100, editingText.length * 10)}px`
              }}
            />
          ) : (
            <span>{element.text}</span>
          )}
        </div>
      ))}
    </div>
  )
}
