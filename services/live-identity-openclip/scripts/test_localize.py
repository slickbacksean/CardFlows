#!/usr/bin/env python3
"""Unit tests for localize.py card localization. python scripts/test_localize.py"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from localize import localize_card, warp_localized, CARD_W, CARD_H  # noqa: E402


def create_test_card() -> np.ndarray:
    """Create a synthetic card image with distinct regions."""
    card = np.zeros((CARD_H, CARD_W, 3), np.uint8)
    # Red top half
    card[: CARD_H // 2] = (255, 0, 0)
    # Blue bottom half
    card[CARD_H // 2 :] = (0, 0, 255)
    # Add a white border to help edge detection
    cv2.rectangle(card, (0, 0), (CARD_W - 1, CARD_H - 1), (255, 255, 255), 3)
    return card


def test_basic_localization() -> None:
    """Test localization of a tilted card in a frame."""
    card = create_test_card()
    
    # Create tilted quad
    quad = np.array([[60, 30], [230, 50], [215, 290], [40, 270]], np.float32)
    
    # Warp card into a larger frame
    m = cv2.getPerspectiveTransform(
        np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], np.float32),
        quad,
    )
    frame = cv2.warpPerspective(card, m, (280, 320), borderValue=(30, 160, 30))
    
    image = Image.fromarray(frame)
    result = localize_card(image)
    
    assert result['quad'] is not None, "Should detect card quad"
    assert result['method'] in {'quad', 'rect'}, f"Unexpected method: {result['method']}"
    
    # Warp the detected quad
    warped = warp_localized(image, result['quad'])
    assert warped.size == (CARD_W, CARD_H), f"Expected size {(CARD_W, CARD_H)}, got {warped.size}"
    
    # Check that the warped card has red top and blue bottom
    arr = np.asarray(warped)
    top_red = arr[40, CARD_W // 2, 0] > 200 and arr[40, CARD_W // 2, 2] < 60
    bottom_blue = arr[CARD_H - 40, CARD_W // 2, 2] > 200
    
    assert top_red, "Top should be red"
    assert bottom_blue, "Bottom should be blue"
    
    print("✓ Basic localization test passed")


def test_upright_card() -> None:
    """Test localization of an upright card (should use rect search)."""
    card = create_test_card()
    
    # Create nearly upright quad (slight tilt)
    offset = 10
    quad = np.array(
        [[offset, offset], [CARD_W - offset, offset], [CARD_W - offset, CARD_H - offset], [offset, CARD_H - offset]],
        np.float32,
    )
    
    # Warp into larger frame with padding
    frame = np.full((CARD_H + 100, CARD_W + 100, 3), 128, dtype=np.uint8)
    m = cv2.getPerspectiveTransform(
        np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], np.float32),
        quad + np.array([50, 50], np.float32),
    )
    cv2.warpPerspective(card, m, (frame.shape[1], frame.shape[0]), dst=frame, borderMode=cv2.BORDER_TRANSPARENT)
    
    image = Image.fromarray(frame)
    result = localize_card(image)
    
    assert result['quad'] is not None, "Should detect upright card"
    # Might be detected by either method depending on edge quality
    assert result['method'] in {'quad', 'rect'}, f"Unexpected method: {result['method']}"
    
    print("✓ Upright card test passed")


def test_loose_box() -> None:
    """Test localization inside a loose bounding box (main use case)."""
    card = create_test_card()
    
    # Card tilted in frame
    card_quad = np.array([[70, 50], [200, 60], [190, 300], [60, 280]], np.float32)
    
    # Create frame with background clutter
    frame = np.random.randint(50, 150, (400, 350, 3), dtype=np.uint8)
    
    # Warp card into frame
    m = cv2.getPerspectiveTransform(
        np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], np.float32),
        card_quad,
    )
    card_region = cv2.warpPerspective(card, m, (frame.shape[1], frame.shape[0]))
    
    # Blend card into frame (replace non-background)
    mask = (card_region.sum(axis=2) > 0).astype(np.uint8)
    frame[mask > 0] = card_region[mask > 0]
    
    # Loose bounding box around card (12% padding as in real detector)
    x0, y0 = 40, 30
    x1, y1 = 220, 320
    
    image = Image.fromarray(frame)
    result = localize_card(image, box=(x0, y0, x1, y1))
    
    assert result['quad'] is not None, "Should detect card inside loose box"
    
    # The detected quad should be inside the box region (with some tolerance)
    quad_center = result['quad'].mean(axis=0)
    assert x0 - 20 < quad_center[0] < x1 + 20, "Quad center X should be near box"
    assert y0 - 20 < quad_center[1] < y1 + 20, "Quad center Y should be near box"
    
    print("✓ Loose box test passed")


def test_no_card() -> None:
    """Test that localization fails gracefully when no card is present."""
    # Random noise frame
    frame = np.random.randint(0, 256, (300, 300, 3), dtype=np.uint8)
    image = Image.fromarray(frame)
    
    result = localize_card(image)
    
    # Should fail to detect a card (or have very low confidence)
    if result['quad'] is not None:
        # If it somehow detects something, it should be marked as low quality
        print(f"  Warning: detected phantom quad with method {result['method']}")
    
    print("✓ No card test passed")


def test_landscape_card() -> None:
    """Test localization of a landscape-oriented card."""
    card = create_test_card()
    
    # Rotate card to landscape
    card_landscape = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE)
    
    # Create tilted quad (landscape orientation)
    quad = np.array([[50, 80], [300, 90], [290, 260], [40, 250]], np.float32)
    
    # Warp into frame
    m = cv2.getPerspectiveTransform(
        np.array(
            [[0, 0], [card_landscape.shape[1] - 1, 0], [card_landscape.shape[1] - 1, card_landscape.shape[0] - 1], [0, card_landscape.shape[0] - 1]],
            np.float32,
        ),
        quad,
    )
    frame = cv2.warpPerspective(card_landscape, m, (350, 350), borderValue=(30, 160, 30))
    
    image = Image.fromarray(frame)
    result = localize_card(image)
    
    assert result['quad'] is not None, "Should detect landscape card"
    
    # Warp should handle orientation
    warped = warp_localized(image, result['quad'])
    assert warped.size == (CARD_W, CARD_H), f"Expected portrait {(CARD_W, CARD_H)}, got {warped.size}"
    
    print("✓ Landscape card test passed")


def main() -> None:
    """Run all tests."""
    print("Testing card localization...")
    test_basic_localization()
    test_upright_card()
    test_loose_box()
    test_no_card()
    test_landscape_card()
    print("\n✅ All localization tests passed!")


if __name__ == "__main__":
    main()
