/**
 * Whether a tool option card (pen / eraser / … popover) is open. Read by the ink canvas at touch time: while a card is
 * open, the first touch on the page only closes the card and must not draw. A plain module value (not React state)
 * because page slots are memoised and must not re-render when the card opens or closes.
 */
export const toolCard = { open: false };
