//! Fixed-point helpers. All multiplications that can exceed u128 go through U256.

uint::construct_uint! {
    pub struct U256(4);
}

/// floor(a * b / c)
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "division by zero");
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    assert!(r <= U256::from(u128::MAX), "mul_div overflow");
    r.as_u128()
}

/// ceil(a * b / c)
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "division by zero");
    let n = U256::from(a) * U256::from(b);
    let d = U256::from(c);
    let mut r = n / d;
    if r * d != n {
        r += U256::one();
    }
    assert!(r <= U256::from(u128::MAX), "mul_div overflow");
    r.as_u128()
}

pub const BPS: u128 = 10_000;

pub fn bps(amount: u128, bps: u128) -> u128 {
    mul_div(amount, bps, BPS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_handles_large_values() {
        let a = 1_000_000_000_000_000_000_000_000_000u128; // 1e27
        assert_eq!(mul_div(a, a, a), a);
        assert_eq!(mul_div_ceil(10, 1, 3), 4);
        assert_eq!(mul_div(10, 1, 3), 3);
    }
}
